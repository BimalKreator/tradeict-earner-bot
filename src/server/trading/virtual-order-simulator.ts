import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { isHedgeScalpingStrategySlug } from "@/lib/hedge-scalping-config";
import { db } from "@/server/db";
import {
  hedgeScalpingVirtualRuns,
  strategies,
  virtualBotOrders,
  virtualStrategyRuns,
} from "@/server/db/schema";
import type { TradingExecutionJobPayload } from "@/server/db/schema";

import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";
import { hedgeScalpingD2Side } from "@/server/trading/hedge-scalping/engine-math";
import { hedgeOpenSide } from "@/server/trading/hedge-scalping/virtual-integration";

import { fetchDeltaExchangeCandles, filterClosedCandles } from "./ta-engine/rsi-scalper";
import type { EligibleVirtualRunRow } from "./virtual-eligibility";
import { generateInternalClientOrderId } from "./ids";
import { tradingLog } from "./trading-log";

const EPS = 1e-8;

function num(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function extractMarkPriceFromPayload(
  p: TradingExecutionJobPayload,
): number | null {
  const m = p.signalMetadata;
  if (!m || typeof m !== "object") return null;
  const rec = m as Record<string, unknown>;
  const candidates = [
    rec.mark_price,
    rec.markPrice,
    rec.last_price,
    rec.lastPrice,
    rec.close,
    rec.reference_price,
  ];
  for (const c of candidates) {
    const v =
      typeof c === "number"
        ? c
        : typeof c === "string"
          ? Number(c.trim())
          : NaN;
    if (Number.isFinite(v) && v > 0) return v;
  }
  if (p.orderType === "limit" && p.limitPrice) {
    const lp = num(p.limitPrice);
    if (lp > 0) return lp;
  }
  return null;
}

async function resolveFillPriceUsd(
  p: TradingExecutionJobPayload,
): Promise<number | null> {
  const direct = extractMarkPriceFromPayload(p);
  if (direct != null) return direct;

  const base =
    process.env.DELTA_PUBLIC_BASE_URL?.trim() || "https://api.delta.exchange";
  try {
    const candles = await fetchDeltaExchangeCandles({
      baseUrl: base,
      symbol: p.symbol,
      resolution: "1m",
      lookbackSec: 7200,
    });
    const closed = filterClosedCandles(candles, 60);
    const last = closed[closed.length - 1];
    if (last && Number.isFinite(last.close) && last.close > 0) {
      return last.close;
    }
  } catch {
    /* handled below */
  }
  try {
    const india = await fetchDeltaIndiaTickerMarkPrice({ symbol: p.symbol });
    if (india != null && india > 0) return india;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * When hedge-scalping simulates a D2 ladder entry after D1, pin fill to the latest D1 entry
 * fill for the same virtual run so the hedge leg does not drift vs ticker/candle fallback.
 * Correlation ids follow `hs_d2_step{N}_<clipUuid>` (poller uses steps 1+).
 */
async function alignHedgeScalpingInitialD2FillToD1(params: {
  payload: TradingExecutionJobPayload;
  virtualRunId: string;
  strategyId: string;
  resolvedPrice: number;
}): Promise<number> {
  const { payload: p, virtualRunId, strategyId, resolvedPrice } = params;
  if (!db) return resolvedPrice;

  const cid = (p.correlationId ?? "").toLowerCase();
  if (!/^hs_d2_step\d+_/i.test(cid) || cid.startsWith("hs_d2_exit")) return resolvedPrice;

  const [primaryRow] = await db
    .select({ fillPrice: virtualBotOrders.fillPrice })
    .from(virtualBotOrders)
    .where(
      and(
        eq(virtualBotOrders.virtualRunId, virtualRunId),
        eq(virtualBotOrders.strategyId, strategyId),
        sql`LOWER(${virtualBotOrders.correlationId}) LIKE 'hs_d1_%'`,
        sql`LOWER(${virtualBotOrders.correlationId}) NOT LIKE 'hs_d1_exit%'`,
        inArray(virtualBotOrders.status, ["filled", "partial_fill"]),
      ),
    )
    .orderBy(desc(virtualBotOrders.createdAt))
    .limit(1);

  const d1Px = primaryRow?.fillPrice != null ? num(primaryRow.fillPrice) : NaN;
  if (!(d1Px > 0)) return resolvedPrice;

  const driftPct =
    resolvedPrice > 0 ? Math.abs(d1Px - resolvedPrice) / resolvedPrice : 0;
  if (driftPct > 1e-4) {
    tradingLog("info", "virtual_hs_d2_entry_fill_aligned_to_d1", {
      virtualRunId,
      correlationId: p.correlationId,
      resolvedPrice,
      d1FillPrice: d1Px,
      driftPct: Number(driftPct.toFixed(6)),
    });
  }
  return d1Px;
}

type SimResult = {
  newQ: number;
  newAvg: number | null;
  newUsedMargin: number;
  newCash: number;
  newRealized: number;
  /** PnL realized in this job only (USD). */
  fillRealizedPnl: number;
  /** For exit leg reporting. */
  profitPercent: number | null;
  simulation: Record<string, unknown>;
};

function applyVirtualFill(params: {
  Q: number;
  avg: number | null;
  usedMargin: number;
  cash: number;
  realized: number;
  lev: number;
  signedDelta: number;
  price: number;
  symbol: string;
  openSymbol: string | null;
  /** Hedge-scalping D2 entry: allow fill when wallet cash is already tied up by D1 (dual-account hedge). */
  bypassCashMarginSufficiencyCheck?: boolean;
}): { ok: true; out: SimResult } | { ok: false; error: string } {
  let { Q, avg, usedMargin, cash, realized, lev } = params;
  const { signedDelta, price, symbol, openSymbol } = params;
  const bypassMarginCheck = params.bypassCashMarginSufficiencyCheck === true;

  if (Math.abs(signedDelta) < EPS) {
    return { ok: false, error: "virtual_zero_quantity" };
  }

  if (Q !== 0 && openSymbol && openSymbol !== symbol) {
    return {
      ok: false,
      error: `virtual_symbol_mismatch_open=${openSymbol}_signal=${symbol}`,
    };
  }

  if (!(price > 0) || !(lev > 0)) {
    return { ok: false, error: "virtual_invalid_price_or_leverage" };
  }

  const steps: Record<string, unknown>[] = [];
  let rem = signedDelta;
  let fillRealizedPnl = 0;
  let closedEntryNotionalForPct = 0;

  while (Math.abs(rem) > EPS) {
    if (Math.abs(Q) < EPS) {
      const im = (Math.abs(rem) * price) / lev;
      if (!bypassMarginCheck && im > cash + 1e-6) {
        return {
          ok: false,
          error: `virtual_insufficient_margin need=${im.toFixed(2)} have=${cash.toFixed(2)}`,
        };
      }
      cash -= im;
      Q = rem;
      avg = price;
      usedMargin = im;
      steps.push({ kind: "open", qty: rem, price, im });
      rem = 0;
      continue;
    }

    const qSign = Math.sign(Q);

    if (qSign === Math.sign(rem)) {
      const addAbs = Math.abs(rem);
      const oldAbs = Math.abs(Q);
      const newAbs = oldAbs + addAbs;
      const newAvg =
        (oldAbs * (avg ?? price) + addAbs * price) / newAbs;
      const newUsed = (newAbs * newAvg) / lev;
      const deltaIm = newUsed - usedMargin;
      if (!bypassMarginCheck && deltaIm > cash + 1e-6) {
        return {
          ok: false,
          error: `virtual_insufficient_margin_add need=${deltaIm.toFixed(2)} have=${cash.toFixed(2)}`,
        };
      }
      cash -= deltaIm;
      Q = qSign * newAbs;
      avg = newAvg;
      usedMargin = newUsed;
      steps.push({ kind: "scale_in", add: rem, price, newAvg });
      rem = 0;
      continue;
    }

    const closeAbs = Math.min(Math.abs(Q), Math.abs(rem));
    const entryPx = avg ?? price;
    const pnl = closeAbs * qSign * (price - entryPx);
    const released = usedMargin * (closeAbs / Math.abs(Q));
    cash += released + pnl;
    realized += pnl;
    fillRealizedPnl += pnl;
    closedEntryNotionalForPct += closeAbs * entryPx;
    usedMargin -= released;
    Q = qSign * (Math.abs(Q) - closeAbs);
    if (Math.abs(Q) < EPS) {
      Q = 0;
      avg = null;
      usedMargin = 0;
    }
    steps.push({ kind: "close", closeAbs, price, pnl, released });
    rem += qSign * closeAbs;
  }

  const profitPercent =
    closedEntryNotionalForPct > 0 && Math.abs(fillRealizedPnl) > EPS
      ? (fillRealizedPnl / closedEntryNotionalForPct) * 100
      : fillRealizedPnl !== 0
        ? 0
        : null;

  return {
    ok: true,
    out: {
      newQ: Q,
      newAvg: avg,
      newUsedMargin: Math.max(0, usedMargin),
      newCash: cash,
      newRealized: realized,
      fillRealizedPnl,
      profitPercent,
      simulation: { steps },
    },
  };
}

/**
 * Instant paper fill: no exchange adapter. Persists `virtual_bot_orders` and updates the run row.
 */
export async function simulateVirtualOrder(params: {
  payload: TradingExecutionJobPayload;
  row: EligibleVirtualRunRow;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: "db_unavailable" };

  const p = params.payload;
  const { row } = params;

  if (p.strategyId !== row.strategyId || p.targetUserId !== row.userId) {
    return { ok: false, error: "virtual_payload_user_mismatch" };
  }

  const qtyNumRaw = num(p.quantity);
  const qtyNum = Math.floor(Math.abs(qtyNumRaw));
  if (!(qtyNum > 0)) {
    return { ok: false, error: "virtual_invalid_quantity" };
  }

  const cidLower = (p.correlationId ?? "").toLowerCase();
  const isHsD2EntryCorrelation =
    /^hs_d2_step\d+_/i.test(cidLower) && !cidLower.startsWith("hs_d2_exit");

  let hedgeScalpingStrategy = false;
  if (db) {
    const [sr] = await db
      .select({ slug: strategies.slug })
      .from(strategies)
      .where(eq(strategies.id, row.strategyId))
      .limit(1);
    hedgeScalpingStrategy = isHedgeScalpingStrategySlug(sr?.slug ?? "");
  }

  if (
    hedgeScalpingStrategy &&
    (p.signalAction ?? "entry") === "entry" &&
    isHsD2EntryCorrelation
  ) {
    const [hr] = await db
      .select({ d1Side: hedgeScalpingVirtualRuns.d1Side })
      .from(hedgeScalpingVirtualRuns)
      .where(
        and(
          eq(hedgeScalpingVirtualRuns.userId, row.userId),
          eq(hedgeScalpingVirtualRuns.strategyId, row.strategyId),
          eq(hedgeScalpingVirtualRuns.status, "active"),
        ),
      )
      .limit(1);
    if (hr) {
      const expectedOrderSide = hedgeOpenSide(hedgeScalpingD2Side(hr.d1Side));
      if (p.side !== expectedOrderSide) {
        return { ok: false, error: "virtual_hs_d2_side_mismatch_with_d1" };
      }
    }
  }

  const signedDelta = p.side === "buy" ? qtyNum : -qtyNum;
  let price = await resolveFillPriceUsd(p);
  if (price == null || !(price > 0)) {
    return { ok: false, error: "virtual_mark_price_unavailable" };
  }

  price = await alignHedgeScalpingInitialD2FillToD1({
    payload: p,
    virtualRunId: row.virtualRunId,
    strategyId: row.strategyId,
    resolvedPrice: price,
  });

  const now = new Date();
  const internalClientOrderId = generateInternalClientOrderId();

  try {
    const result = await db.transaction(async (tx) => {
      if (p.correlationId) {
        const [existing] = await tx
          .select({
            id: virtualBotOrders.id,
            status: virtualBotOrders.status,
          })
          .from(virtualBotOrders)
          .where(
            and(
              eq(virtualBotOrders.correlationId, p.correlationId),
              eq(virtualBotOrders.virtualRunId, row.virtualRunId),
            ),
          )
          .limit(1);

        if (
          existing &&
          (existing.status === "filled" ||
            existing.status === "partial_fill" ||
            existing.status === "failed" ||
            existing.status === "rejected")
        ) {
          return { ok: true as const, skipped: true };
        }
      }

      const [run] = await tx
        .select()
        .from(virtualStrategyRuns)
        .where(eq(virtualStrategyRuns.id, row.virtualRunId))
        .limit(1);

      if (!run) {
        return { ok: false as const, error: "virtual_run_missing" };
      }

      const lev = num(row.leverage);
      const Q = num(run.openNetQty);
      const usedMargin = num(run.virtualUsedMarginUsd);
      const cash = num(run.virtualAvailableCashUsd);
      const realized = num(run.virtualRealizedPnlUsd);

      const avgForSim =
        run.openAvgEntryPrice != null
          ? (Number.isFinite(num(run.openAvgEntryPrice))
              ? num(run.openAvgEntryPrice)
              : null)
          : null;

      const signalAction = p.signalAction ?? "entry";
      const cid = (p.correlationId ?? "").toLowerCase();
      const bypassHsD2EntryMargin =
        hedgeScalpingStrategy &&
        signalAction === "entry" &&
        cid.startsWith("hs_d2_") &&
        !cid.startsWith("hs_d2_exit_");

      const sim = applyVirtualFill({
        Q: Number.isFinite(Q) ? Q : 0,
        avg: avgForSim,
        usedMargin: Number.isFinite(usedMargin) ? usedMargin : 0,
        cash: Number.isFinite(cash) ? cash : 0,
        realized: Number.isFinite(realized) ? realized : 0,
        lev: Number.isFinite(lev) && lev > 0 ? lev : 1,
        signedDelta,
        price,
        symbol: p.symbol,
        openSymbol: run.openSymbol,
        bypassCashMarginSufficiencyCheck: bypassHsD2EntryMargin,
      });

      if (!sim.ok) {
        await tx.insert(virtualBotOrders).values({
          internalClientOrderId,
          correlationId: p.correlationId ?? null,
          virtualRunId: row.virtualRunId,
          userId: row.userId,
          strategyId: row.strategyId,
          symbol: p.symbol,
          side: p.side,
          orderType: p.orderType,
          quantity: String(Math.abs(qtyNum)),
          limitPrice: p.limitPrice ?? null,
          status: "failed",
          lastSyncedAt: now,
          tradeSource: "bot",
          venueOrderState: "simulated",
          fillPrice: String(price),
          filledQty: "0",
          signalAction: p.signalAction ?? "entry",
          rawSubmitResponse: {
            error: sim.error,
            mark_price: price,
            ...(p.signalMetadata && typeof p.signalMetadata === "object"
              ? { signal_metadata_snapshot: p.signalMetadata }
              : {}),
          },
          errorMessage: sim.error,
          updatedAt: now,
        });
        return { ok: true as const, skipped: false, recordedFailure: sim.error };
      }

      const { out } = sim;

      await tx.insert(virtualBotOrders).values({
        internalClientOrderId,
        correlationId: p.correlationId ?? null,
        virtualRunId: row.virtualRunId,
        userId: row.userId,
        strategyId: row.strategyId,
        symbol: p.symbol,
        side: p.side,
        orderType: p.orderType,
        quantity: String(Math.abs(qtyNum)),
        limitPrice: p.limitPrice ?? null,
        status: "filled",
        lastSyncedAt: now,
        tradeSource: "bot",
        venueOrderState: "simulated",
        fillPrice: String(price),
        filledQty: String(Math.abs(qtyNum)),
        realizedPnlUsd:
          Math.abs(out.fillRealizedPnl) > EPS
            ? String(out.fillRealizedPnl.toFixed(2))
            : null,
        profitPercent:
          out.profitPercent != null
            ? String(out.profitPercent.toFixed(6))
            : null,
        signalAction: p.signalAction ?? "entry",
        rawSubmitResponse: {
          mark_price: price,
          leverage: row.leverage,
          ...(p.signalMetadata && typeof p.signalMetadata === "object"
            ? { signal_metadata_snapshot: p.signalMetadata }
            : {}),
          ...out.simulation,
        },
        updatedAt: now,
      });

      await tx
        .update(virtualStrategyRuns)
        .set({
          openNetQty: String(out.newQ),
          openAvgEntryPrice:
            out.newAvg != null && Math.abs(out.newQ) > EPS
              ? String(out.newAvg)
              : null,
          openSymbol:
            Math.abs(out.newQ) > EPS ? p.symbol : null,
          virtualAvailableCashUsd: String(out.newCash.toFixed(2)),
          virtualUsedMarginUsd: String(out.newUsedMargin.toFixed(2)),
          virtualRealizedPnlUsd: String(out.newRealized.toFixed(2)),
          updatedAt: now,
        })
        .where(eq(virtualStrategyRuns.id, row.virtualRunId));

      return { ok: true as const, skipped: false };
    });

    if ("skipped" in result && result.skipped) {
      tradingLog("info", "virtual_order_deduped", {
        virtualRunId: row.virtualRunId,
        correlationId: p.correlationId,
      });
    }

    if (result.ok === false) {
      return { ok: false, error: result.error };
    }
    if ("recordedFailure" in result && result.recordedFailure) {
      tradingLog("warn", "virtual_order_recorded_failure", {
        virtualRunId: row.virtualRunId,
        error: result.recordedFailure,
      });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("error", "virtual_order_sim_failed", {
      virtualRunId: row.virtualRunId,
      error: msg,
    });
    return { ok: false, error: msg.slice(0, 500) };
  }
}
