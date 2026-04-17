import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { trendArbStrategyConfigSchema } from "@/lib/trend-arb-strategy-config";
import {
  classifyTrendArbAccount,
  deriveLedgerMetrics,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { db } from "@/server/db";
import { botOrders, strategies, virtualBotOrders, virtualStrategyRuns } from "@/server/db/schema";
import {
  fetchDeltaIndiaPosition,
  fetchDeltaIndiaTickerMarkPrice,
} from "@/server/exchange/delta-india-positions";
import { hasTradingJobForCorrelationId } from "@/server/trading/execution-queue";
import { resolveDeltaIndiaProductId } from "@/server/trading/delta-symbol-to-product";
import { tradingLog } from "@/server/trading/trading-log";

import {
  dispatchTrendArbClosePrimary,
  dispatchTrendArbCloseSecondaryClip,
  dispatchTrendArbFlattenSecondary,
  dispatchTrendArbSecondaryHedgeClip,
} from "./trend-arb-dispatch";
import type { D2LadderOrderRow } from "./trend-arb-d2-ladder";
import {
  buildOpenD2ClipsFromOrders,
  d2ClipTpHit,
  d2RungTriggerPrice,
  d2StepLabel,
  TREND_ARB_D2_MAX_DISPLAY_STEP,
} from "./trend-arb-d2-ladder";
import {
  clearHedgeStepsForRun,
  clearVirtualHedgeStepsForRun,
} from "./trend-arb-hedge-db";
import {
  getDeltaCredentialsForConnection,
  type TrendArbExecutionScope,
} from "./trend-arb-scope";
import type { TrendArbitrageEnv } from "./trend-arb-types";

const MIN_MS_PRIMARY_POLL = 2000;
const MIN_MS_TICKER = 1500;

const lastPrimaryPollAt = new Map<string, number>();
const lastTickerPollAt = new Map<string, number>();
/** Max favorable unrealized % seen while D1 was open (per run); reset when flat. */
const d1PeakUrpPct = new Map<string, number>();
/** Last D1 side while position was open — used to pick D2 flatten direction after D1 disappears. */
const lastD1SideWhileOpen = new Map<string, "long" | "short">();

function computeD2StepQuantityFromD1Qty(params: {
  d1Qty: number;
  stepQtyPct: number;
  fallbackQty: string;
}): string {
  const d1 = Number(params.d1Qty);
  const pct = Number(params.stepQtyPct);
  if (!(Number.isFinite(d1) && d1 > 0) || !(Number.isFinite(pct) && pct > 0)) {
    return params.fallbackQty;
  }
  const qty = d1 * (pct / 100);
  if (!(Number.isFinite(qty) && qty > 0)) return params.fallbackQty;
  return qty.toFixed(6);
}

async function loadLiveRiskSettings(strategyId: string, fallback: TrendArbitrageEnv["runtime"]): Promise<{
  stepMovePct: number;
  d2TargetProfitPct: number;
  d2StopLossPct: number;
  d2StepQtyPct: number;
  d1TargetProfitPct: number;
  d1StopLossPct: number;
}> {
  if (!db) {
    return {
      stepMovePct: Math.max(0.1, fallback.d2StepMovePct),
      d2TargetProfitPct: Math.max(0.1, fallback.d2TargetProfitPct),
      d2StopLossPct: Math.max(0.1, fallback.d2StopLossPct),
      d2StepQtyPct: Math.max(0, fallback.d2StepQtyPct),
      d1TargetProfitPct: Math.max(0.1, fallback.d1TargetProfitPct),
      d1StopLossPct: Math.max(0.1, fallback.d1StopLossPct),
    };
  }
  // NOTE: intentionally re-query DB every call (no in-memory cache) so mid-trade setting edits
  // like stepMovePct=0.15 are applied on the very next poll tick.
  const [row] = await db
    .select({ settingsJson: strategies.settingsJson })
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), isNull(strategies.deletedAt)))
    .limit(1);
  const parsed = trendArbStrategyConfigSchema.safeParse(row?.settingsJson ?? null);
  if (!parsed.success) {
    return {
      stepMovePct: Math.max(0.1, fallback.d2StepMovePct),
      d2TargetProfitPct: Math.max(0.1, fallback.d2TargetProfitPct),
      d2StopLossPct: Math.max(0.1, fallback.d2StopLossPct),
      d2StepQtyPct: Math.max(0, fallback.d2StepQtyPct),
      d1TargetProfitPct: Math.max(0.1, fallback.d1TargetProfitPct),
      d1StopLossPct: Math.max(0.1, fallback.d1StopLossPct),
    };
  }
  return {
    stepMovePct: Math.max(0.1, parsed.data.delta2.stepMovePct),
    d2TargetProfitPct: Math.max(0.1, parsed.data.delta2.targetProfitPct),
    d2StopLossPct: Math.max(0.1, parsed.data.delta2.stopLossPct),
    d2StepQtyPct: Math.max(0, parsed.data.delta2.stepQtyPct),
    d1TargetProfitPct: Math.max(0.1, parsed.data.delta1.targetProfitPct),
    d1StopLossPct: Math.max(0.1, parsed.data.delta1.stopLossPct),
  };
}

async function readVirtualNetForRun(runId: string): Promise<number | null> {
  if (!db) return null;
  const [run] = await db
    .select({ openNetQty: virtualStrategyRuns.openNetQty })
    .from(virtualStrategyRuns)
    .where(eq(virtualStrategyRuns.id, runId))
    .limit(1);
  if (!run) return null;
  const openNetQty = Number(run.openNetQty ?? "0");
  const [agg] = await db
    .select({
      net: sql<number>`COALESCE(SUM(
        CASE
          WHEN ${virtualBotOrders.side} = 'buy' THEN cast(${virtualBotOrders.quantity} as numeric)
          WHEN ${virtualBotOrders.side} = 'sell' THEN -cast(${virtualBotOrders.quantity} as numeric)
          ELSE 0
        END
      ), 0)::float8`,
    })
    .from(virtualBotOrders)
    .where(eq(virtualBotOrders.virtualRunId, runId));
  const ledgerNet = Number(agg?.net ?? 0);
  return Number.isFinite(openNetQty) ? openNetQty : ledgerNet;
}

async function readVirtualTrendArbLegState(runId: string): Promise<{
  d1NetQty: number;
  d2NetQty: number;
  d1EntryPrice: number | null;
  d2Symbol: string | null;
}> {
  if (!db) return { d1NetQty: 0, d2NetQty: 0, d1EntryPrice: null, d2Symbol: null };
  const orderRows = await db
    .select({
      symbol: virtualBotOrders.symbol,
      side: virtualBotOrders.side,
      quantity: virtualBotOrders.quantity,
      fillPrice: virtualBotOrders.fillPrice,
      status: virtualBotOrders.status,
      correlationId: virtualBotOrders.correlationId,
      createdAt: virtualBotOrders.createdAt,
    })
    .from(virtualBotOrders)
    .where(eq(virtualBotOrders.virtualRunId, runId))
    .orderBy(virtualBotOrders.createdAt);

  const ledger: LedgerOrderRow[] = orderRows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    quantity: String(row.quantity),
    fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
    status: row.status,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  }));
  const d1Orders = ledger.filter((order) => classifyTrendArbAccount(order) === "primary");
  const d2Orders = ledger.filter((order) => classifyTrendArbAccount(order) === "secondary");
  const d1 = deriveLedgerMetrics(d1Orders, null);
  const d2 = deriveLedgerMetrics(d2Orders, null);
  return {
    d1NetQty: d1.openNetQty,
    d2NetQty: d2.openNetQty,
    d1EntryPrice: d1.avgEntryPrice,
    d2Symbol: d2.openSymbol,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function throttlePrimaryPoll(runId: string): Promise<void> {
  const last = lastPrimaryPollAt.get(runId) ?? 0;
  const now = Date.now();
  const wait = MIN_MS_PRIMARY_POLL - (now - last);
  if (wait > 0) await sleep(wait);
  lastPrimaryPollAt.set(runId, Date.now());
}

async function throttleTicker(key: string): Promise<void> {
  const last = lastTickerPollAt.get(key) ?? 0;
  const now = Date.now();
  const wait = MIN_MS_TICKER - (now - last);
  if (wait > 0) await sleep(wait);
  lastTickerPollAt.set(key, now);
}

function unrealizedProfitPercent(params: {
  markPrice: number;
  entryPrice: number;
  side: "long" | "short";
}): number {
  const { markPrice, entryPrice, side } = params;
  if (!(entryPrice > 0) || !Number.isFinite(markPrice)) return 0;
  const raw = ((markPrice - entryPrice) / entryPrice) * 100;
  return side === "long" ? raw : -raw;
}

export type TrendArbPollResult = {
  primaryFlat: boolean;
  detail: string;
};

async function monitorActiveVirtualRuns(params: {
  env: TrendArbitrageEnv;
  barTime: number;
  markPrice: number;
}): Promise<string[]> {
  const { env, barTime, markPrice } = params;
  if (!db) return [];
  const rows = await db
    .select({
      runId: virtualStrategyRuns.id,
      userId: virtualStrategyRuns.userId,
      openNetQty: virtualStrategyRuns.openNetQty,
      openAvgEntryPrice: virtualStrategyRuns.openAvgEntryPrice,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.strategyId, env.strategyId),
        eq(virtualStrategyRuns.status, "active"),
      ),
    );

  const parts: string[] = [];
  for (const r of rows) {
    const legState = await readVirtualTrendArbLegState(r.runId);
    const d1NetQty = legState.d1NetQty;
    const d2NetQty = legState.d2NetQty;
    // Prefer run-row D1 avg (virtual simulator + dashboard) over ledger replay VWAP so step
    // targets match the entry price users see; ledger replay can diverge after mis-tagged legs
    // or partial history and skew 0.1% / 0.2% clip thresholds.
    const runRowEntry = Number(r.openAvgEntryPrice ?? "0");
    const entry =
      runRowEntry > 0 ? runRowEntry : legState.d1EntryPrice ?? 0;

    if (Math.abs(d1NetQty) <= 1e-8 && Math.abs(d2NetQty) > 1e-8) {
      console.log(`[VIRTUAL-CLEANUP] D1 is flat. Flattening orphaned D2 position for run ${r.runId}`);
      const flattenSide = d2NetQty > 0 ? "sell" : "buy";
      const cleanup = await dispatchTrendArbFlattenSecondary({
        strategyId: env.strategyId,
        symbol: legState.d2Symbol ?? r.openSymbol ?? env.runtime.symbol,
        reason: "virtual_primary_flat_cleanup",
        nonce: `virtual_d2_cleanup_${r.runId}_${Date.now()}`,
        markPrice,
        targetUserIds: [r.userId],
        quantity: String(Math.abs(d2NetQty)),
        flattenSide,
      });
      if (cleanup.ok && cleanup.jobsEnqueued > 0) {
        await clearVirtualHedgeStepsForRun(r.runId);
        parts.push(`vcleanup:${r.runId}:jobs${cleanup.jobsEnqueued}`);
      } else {
        parts.push(`vcleanup_skip:${r.runId}:${cleanup.ok ? "zero_jobs" : cleanup.error}`);
      }
      continue;
    }

    if (!(Math.abs(d1NetQty) > 1e-8) || !(entry > 0)) continue;
    const d1Side: "long" | "short" = d1NetQty > 0 ? "long" : "short";
    console.log(
      `[MONITORING-VIRTUAL] Run ${r.runId} is Active. Checking D2 triggers...`,
    );

    const latestRisk = await loadLiveRiskSettings(env.strategyId, env.runtime);

    const voRows = await db
      .select({
        createdAt: virtualBotOrders.createdAt,
        correlationId: virtualBotOrders.correlationId,
        side: virtualBotOrders.side,
        quantity: virtualBotOrders.quantity,
        fillPrice: virtualBotOrders.fillPrice,
        status: virtualBotOrders.status,
        signalAction: virtualBotOrders.signalAction,
        rawSubmitResponse: virtualBotOrders.rawSubmitResponse,
      })
      .from(virtualBotOrders)
      .where(eq(virtualBotOrders.virtualRunId, r.runId))
      .orderBy(asc(virtualBotOrders.createdAt));

    const ladderRows = voRows.map((row) => ({
      createdAt: row.createdAt,
      correlationId: row.correlationId,
      side: row.side,
      quantity: String(row.quantity),
      fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
      status: row.status,
      signalAction: row.signalAction,
      rawSubmitResponse: row.rawSubmitResponse as Record<string, unknown> | null,
    }));

    const openClips = buildOpenD2ClipsFromOrders(ladderRows, d1Side);
    const d2IsShort = d1Side === "long";
    const exitedThisTick = new Set<string>();

    for (const clip of openClips) {
      if (
        !d2ClipTpHit({
          d2IsShort,
          clipEntryPx: clip.entryPx,
          mark: markPrice,
          targetProfitPct: latestRisk.d2TargetProfitPct,
        })
      ) {
        continue;
      }
      const correlationIdOverride = `ta_trendarb_${env.strategyId}_v_${r.runId}_d2X${clip.displayStep}_${Date.now()}`;
      if (await hasTradingJobForCorrelationId(correlationIdOverride)) continue;
      const closeRes = await dispatchTrendArbCloseSecondaryClip({
        strategyId: env.strategyId,
        symbol: r.openSymbol ?? env.runtime.symbol,
        markPrice,
        flattenSide: d2IsShort ? "buy" : "sell",
        quantity: clip.qty.toFixed(6),
        closesEntryCorrelationId: clip.correlationId,
        d2DisplayStep: clip.displayStep,
        correlationNonce: `${r.runId}_${Date.now()}`,
        correlationIdOverride,
        targetUserIds: [r.userId],
      });
      if (closeRes.ok && closeRes.jobsEnqueued > 0) {
        exitedThisTick.add(clip.correlationId);
        parts.push(`vd2_tp:${r.runId}:L${clip.displayStep}`);
        console.log(
          `[D2-TP] Virtual run ${r.runId} exit ${d2StepLabel(clip.displayStep)} | clipEntry=${clip.entryPx.toFixed(2)} mark=${markPrice.toFixed(2)} qty=${clip.qty.toFixed(6)}`,
        );
      } else {
        tradingLog("warn", "ta_trend_arb_virtual_d2_tp_skip", {
          runId: r.runId,
          step: clip.displayStep,
          error: closeRes.ok ? "zero_jobs" : closeRes.error,
        });
      }
    }

    const stillOpen = openClips.filter((c) => !exitedThisTick.has(c.correlationId));

    for (let displayStep = 2; displayStep <= TREND_ARB_D2_MAX_DISPLAY_STEP; displayStep++) {
      if (stillOpen.some((c) => c.displayStep === displayStep)) continue;
      const trig = d2RungTriggerPrice({
        d1Side,
        d1Entry: entry,
        displayStep,
        stepMovePct: latestRisk.stepMovePct,
      });
      if (!Number.isFinite(trig)) continue;
      const crossed = d1Side === "long" ? markPrice >= trig : markPrice <= trig;
      if (!crossed) continue;
      const correlationId = `ta_trendarb_${env.strategyId}_v_${r.runId}_d2L${displayStep}_${Date.now()}`;
      if (await hasTradingJobForCorrelationId(correlationId)) continue;
      console.log(
        `[D2-LADDER] Run ${r.runId} | ${d2StepLabel(displayStep)} add | trigger=${trig.toFixed(2)} mark=${markPrice.toFixed(2)}`,
      );
      const clipRes = await dispatchTrendArbSecondaryHedgeClip({
        strategyId: env.strategyId,
        symbol: r.openSymbol ?? env.runtime.symbol,
        candleTime: barTime,
        stepIndex: displayStep,
        side: d1Side === "long" ? "short" : "long",
        forceSide: d1Side === "long" ? "short" : "long",
        markPrice,
        quantity: computeD2StepQuantityFromD1Qty({
          d1Qty: Math.abs(d1NetQty),
          stepQtyPct: latestRisk.d2StepQtyPct,
          fallbackQty: env.runtime.d2StepQty,
        }),
        stepQtyPct: latestRisk.d2StepQtyPct,
        targetProfitPct: latestRisk.d2TargetProfitPct,
        targetUserIds: [r.userId],
        correlationIdOverride: correlationId,
        applyCapitalSplitSizing: false,
        d2DisplayStep: displayStep,
        d2StepLabel: d2StepLabel(displayStep),
      });
      if (clipRes.ok && clipRes.jobsEnqueued > 0) {
        parts.push(`vd2_add:${r.runId}:L${displayStep}`);
      } else {
        tradingLog("warn", "ta_trend_arb_virtual_hedge_skip", {
          runId: r.runId,
          step: displayStep,
          error: clipRes.ok ? "zero_jobs" : clipRes.error,
        });
      }
    }
  }
  return parts;
}

/**
 * Stateful poll: primary position, D1 soft/hard risk exits, Delta 2 grid hedges, D2 cleanup when D1 flat.
 * Swallows venue/DB errors — returns `primaryFlat: true` on read failure so we do not stack entries blindly.
 */
export async function pollTrendArbRiskAndHedges(params: {
  env: TrendArbitrageEnv;
  scope: TrendArbExecutionScope;
  barTime: number;
  barClose: number;
}): Promise<TrendArbPollResult> {
  const { env, scope, barTime, barClose } = params;
  const parts: string[] = [];

  try {
    await throttlePrimaryPoll(scope.runId);

    const virtualNet = await readVirtualNetForRun(scope.runId);
    if (virtualNet != null && Math.abs(virtualNet) > 1e-8) {
      console.log(`[STATE-SYNC] Detected active position of ${virtualNet}. Switching to D2 monitoring.`);
      return { primaryFlat: false, detail: `virtual_active_${virtualNet}` };
    }

    const cred = await getDeltaCredentialsForConnection({
      userId: scope.userId,
      connectionId: scope.primaryExchangeConnectionId,
    });
    if (!cred.ok) {
      tradingLog("warn", "ta_trend_arb_primary_creds", {
        runId: scope.runId,
        error: cred.error,
      });
      return { primaryFlat: true, detail: `primary_creds:${cred.error}` };
    }

    const product = await resolveDeltaIndiaProductId(env.runtime.symbol);
    if (!product.ok) {
      tradingLog("warn", "ta_trend_arb_product", {
        symbol: env.runtime.symbol,
        error: product.error,
      });
      return { primaryFlat: true, detail: `product:${product.error}` };
    }

    const posRes = await fetchDeltaIndiaPosition({
      apiKey: cred.apiKey,
      apiSecret: cred.apiSecret,
      productId: product.productId,
    });
    if (!posRes.ok) {
      tradingLog("warn", "ta_trend_arb_position_fetch", {
        runId: scope.runId,
        error: posRes.error,
      });
      return { primaryFlat: true, detail: `position_fetch:${posRes.error}` };
    }

    const pos = posRes.position;
    if (!pos.open) {
      d1PeakUrpPct.delete(scope.runId);
      const d1Was = lastD1SideWhileOpen.get(scope.runId) ?? "long";
      if (scope.secondaryExchangeConnectionId) {
        const secCred = await getDeltaCredentialsForConnection({
          userId: scope.userId,
          connectionId: scope.secondaryExchangeConnectionId,
        });
        if (secCred.ok) {
          const d2FlatProbe = await fetchDeltaIndiaPosition({
            apiKey: secCred.apiKey,
            apiSecret: secCred.apiSecret,
            productId: product.productId,
          });
          const d2Sz =
            d2FlatProbe.ok && d2FlatProbe.position.open ? d2FlatProbe.position.size : 0;
          if (d2Sz > 1e-8) {
            const nonce = `d1flat_${barTime}_${Date.now()}`;
            const flattenSide = d1Was === "long" ? "buy" : "sell";
            const flat = await dispatchTrendArbFlattenSecondary({
              strategyId: env.strategyId,
              symbol: env.runtime.symbol,
              reason: "primary_flat_cleanup",
              nonce,
              markPrice: barClose,
              targetUserIds: [scope.userId],
              targetRunIds: [scope.runId],
              flattenSide,
              quantity: String(d2Sz),
            });
            tradingLog("info", "ta_trend_arb_flatten_secondary", {
              runId: scope.runId,
              jobs: flat.ok ? flat.jobsEnqueued : 0,
              error: flat.ok ? undefined : flat.error,
            });
            parts.push(`flatten_d2_jobs:${flat.ok ? flat.jobsEnqueued : 0}`);
          }
        }
        await clearHedgeStepsForRun(scope.runId);
      }
      lastD1SideWhileOpen.delete(scope.runId);
      return { primaryFlat: true, detail: parts.join("|") || "primary_flat" };
    }

    lastD1SideWhileOpen.set(scope.runId, pos.side);

    let mark = pos.markPrice;
    if (mark == null || !(mark > 0)) {
      await throttleTicker(`${scope.runId}_ticker`);
      mark =
        (await fetchDeltaIndiaTickerMarkPrice({ symbol: env.runtime.symbol })) ?? barClose;
    }
    if (!(mark > 0)) mark = barClose;

    const urp = unrealizedProfitPercent({
      markPrice: mark,
      entryPrice: pos.entryPrice,
      side: pos.side,
    });

    const prevPeak = d1PeakUrpPct.get(scope.runId) ?? urp;
    const peak = Math.max(prevPeak, urp);
    d1PeakUrpPct.set(scope.runId, peak);

    const d1Side = pos.side;
    const liveRisk = await loadLiveRiskSettings(env.strategyId, env.runtime);
    const d1Sl = liveRisk.d1StopLossPct;
    const d1Tp = liveRisk.d1TargetProfitPct;
    const liveStepMovePct = liveRisk.stepMovePct;

    let liveD2LadderRows: D2LadderOrderRow[] = [];
    if (db && scope.secondaryExchangeConnectionId) {
      const boRows = await db
        .select({
          createdAt: botOrders.createdAt,
          correlationId: botOrders.correlationId,
          side: botOrders.side,
          quantity: botOrders.quantity,
          fillPrice: botOrders.fillPrice,
          status: botOrders.status,
          rawSubmitResponse: botOrders.rawSubmitResponse,
        })
        .from(botOrders)
        .where(
          and(
            eq(botOrders.runId, scope.runId),
            eq(botOrders.exchangeConnectionId, scope.secondaryExchangeConnectionId),
          ),
        )
        .orderBy(asc(botOrders.createdAt));
      liveD2LadderRows = boRows.map((row) => ({
        createdAt: row.createdAt,
        correlationId: row.correlationId,
        side: row.side,
        quantity: String(row.quantity),
        fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
        status: row.status,
        signalAction: null,
        rawSubmitResponse: row.rawSubmitResponse as Record<string, unknown> | null,
      }));
    }
    const liveOpenClipsPreview = buildOpenD2ClipsFromOrders(liveD2LadderRows, d1Side);

    const hardSlHit = urp <= -d1Sl;
    const hardTpHit = urp >= d1Tp;
    const softBeHit = peak >= Math.max(0.1, d1Tp / 2) && urp <= 0;

    let monD2 = "D2: n/a (no secondary exchange)";
    if (scope.secondaryExchangeConnectionId) {
      monD2 = `D2 ladder clips open=${liveOpenClipsPreview.length} (max ${TREND_ARB_D2_MAX_DISPLAY_STEP} rungs)`;
    }

    const toTgt = d1Tp - urp;
    console.log(
      `[MONITORING] Trade #${scope.runId}: ${d1Side.toUpperCase()} mark ${mark.toFixed(2)}, entry ${pos.entryPrice.toFixed(2)}, Current PnL: ${urp >= 0 ? "+" : ""}${urp.toFixed(2)}%, D1 target +${d1Tp}% (${toTgt >= 0 ? "+" : ""}${toTgt.toFixed(2)}% to target), ${monD2}`,
    );

    console.log(
      `[EXIT-CHECK] Trade #${scope.runId}: D1 — URP ${urp.toFixed(2)}% (SL ≤-${d1Sl}%, TP +${d1Tp}%, peak ${peak.toFixed(2)}%) | hard_sl=${hardSlHit} hard_tp=${hardTpHit} soft_be=${softBeHit}`,
    );

    if (hardSlHit || hardTpHit || softBeHit) {
      const reason = hardSlHit
        ? `hard_sl_${d1Sl}pct`
        : hardTpHit
          ? `hard_tp_${d1Tp}pct`
          : "soft_be_trail";
      const nonce = `${reason}_${Date.now()}`;
      const closeSide = d1Side === "long" ? "sell" : "buy";
      const res = await dispatchTrendArbClosePrimary({
        strategyId: env.strategyId,
        symbol: env.runtime.symbol,
        quantity: String(pos.size),
        side: closeSide,
        markPrice: mark,
        targetUserIds: [scope.userId],
        targetRunIds: [scope.runId],
        correlationNonce: nonce,
        metadataReason: reason,
      });
      tradingLog("info", "ta_trend_arb_close_primary", {
        runId: scope.runId,
        reason,
        urp,
        peak,
        jobs: res.ok ? res.jobsEnqueued : 0,
      });
      if (hardSlHit) {
        tradingLog("warn", "ta_trend_arb_stop_loss_hit", {
          runId: scope.runId,
          delta: 1,
          message: `Stop Loss hit for Delta 1. Exiting position at ${mark}.`,
        });
      }
      parts.push(`close_d1:${reason}`);
      return { primaryFlat: false, detail: parts.join("|") };
    }

    if (scope.secondaryExchangeConnectionId) {
      const secondaryCreds = await getDeltaCredentialsForConnection({
        userId: scope.userId,
        connectionId: scope.secondaryExchangeConnectionId,
      });
      if (secondaryCreds.ok) {
        const d2PosRes = await fetchDeltaIndiaPosition({
          apiKey: secondaryCreds.apiKey,
          apiSecret: secondaryCreds.apiSecret,
          productId: product.productId,
        });
        if (d2PosRes.ok && d2PosRes.position.open) {
          const d2Mark = d2PosRes.position.markPrice ?? mark;
          const d2Urp = unrealizedProfitPercent({
            markPrice: d2Mark,
            entryPrice: d2PosRes.position.entryPrice,
            side: d2PosRes.position.side,
          });
          const d2Sl = liveRisk.d2StopLossPct;
          console.log(
            `[EXIT-CHECK] Trade #${scope.runId}: D2 — URP ${d2Urp.toFixed(2)}% vs stop −${d2Sl}% (mark ${d2Mark.toFixed(2)})`,
          );
          if (d2Urp <= -d2Sl) {
            const nonce = `d2_stop_loss_${Date.now()}`;
            const flattenSide = d2PosRes.position.side === "long" ? "sell" : "buy";
            const flat = await dispatchTrendArbFlattenSecondary({
              strategyId: env.strategyId,
              symbol: env.runtime.symbol,
              reason: "secondary_stop_loss",
              nonce,
              markPrice: d2Mark,
              targetUserIds: [scope.userId],
              targetRunIds: [scope.runId],
              flattenSide,
              quantity: String(d2PosRes.position.size),
            });
            tradingLog("warn", "ta_trend_arb_stop_loss_hit", {
              runId: scope.runId,
              delta: 2,
              message: `Stop Loss hit for Delta 2. Exiting position at ${d2Mark}.`,
              jobs: flat.ok ? flat.jobsEnqueued : 0,
            });
            parts.push("close_d2:stop_loss");
          }
        }
      }
    }

    if (scope.secondaryExchangeConnectionId) {
      const openClips = buildOpenD2ClipsFromOrders(liveD2LadderRows, d1Side);
      const d2IsShort = d1Side === "long";
      const exitedThisTick = new Set<string>();

      for (const clip of openClips) {
        if (
          !d2ClipTpHit({
            d2IsShort,
            clipEntryPx: clip.entryPx,
            mark,
            targetProfitPct: liveRisk.d2TargetProfitPct,
          })
        ) {
          continue;
        }
        const correlationIdOverride = `ta_trendarb_${env.strategyId}_d2_${scope.runId}_d2X${clip.displayStep}_${Date.now()}`;
        if (await hasTradingJobForCorrelationId(correlationIdOverride)) continue;
        const closeRes = await dispatchTrendArbCloseSecondaryClip({
          strategyId: env.strategyId,
          symbol: env.runtime.symbol,
          markPrice: mark,
          flattenSide: d2IsShort ? "buy" : "sell",
          quantity: clip.qty.toFixed(6),
          closesEntryCorrelationId: clip.correlationId,
          d2DisplayStep: clip.displayStep,
          correlationNonce: `${scope.runId}_${Date.now()}`,
          correlationIdOverride,
          targetUserIds: [scope.userId],
          targetRunIds: [scope.runId],
        });
        if (closeRes.ok && closeRes.jobsEnqueued > 0) {
          exitedThisTick.add(clip.correlationId);
          parts.push(`d2_tp:${scope.runId}:L${clip.displayStep}`);
          console.log(
            `[D2-TP] Live run ${scope.runId} exit ${d2StepLabel(clip.displayStep)} | clipEntry=${clip.entryPx.toFixed(2)} mark=${mark.toFixed(2)}`,
          );
        } else {
          tradingLog("warn", "ta_trend_arb_d2_tp_skip", {
            runId: scope.runId,
            step: clip.displayStep,
            error: closeRes.ok ? "zero_jobs" : closeRes.error,
          });
        }
      }

      const stillOpen = openClips.filter((c) => !exitedThisTick.has(c.correlationId));

      for (let displayStep = 2; displayStep <= TREND_ARB_D2_MAX_DISPLAY_STEP; displayStep++) {
        if (stillOpen.some((c) => c.displayStep === displayStep)) continue;
        const trig = d2RungTriggerPrice({
          d1Side,
          d1Entry: pos.entryPrice,
          displayStep,
          stepMovePct: liveRisk.stepMovePct,
        });
        if (!Number.isFinite(trig)) continue;
        const crossed = d1Side === "long" ? mark >= trig : mark <= trig;
        if (!crossed) continue;
        const correlationId = `ta_trendarb_${env.strategyId}_d2_${scope.runId}_d2L${displayStep}_${Date.now()}`;
        if (await hasTradingJobForCorrelationId(correlationId)) continue;
        console.log(
          `[D2-LADDER] Live run ${scope.runId} | ${d2StepLabel(displayStep)} add | trigger=${trig.toFixed(2)} mark=${mark.toFixed(2)}`,
        );
        const clipRes = await dispatchTrendArbSecondaryHedgeClip({
          strategyId: env.strategyId,
          symbol: env.runtime.symbol,
          candleTime: barTime,
          stepIndex: displayStep,
          side: d1Side === "long" ? "short" : "long",
          forceSide: d1Side === "long" ? "short" : "long",
          markPrice: mark,
          quantity: computeD2StepQuantityFromD1Qty({
            d1Qty: pos.size,
            stepQtyPct: liveRisk.d2StepQtyPct,
            fallbackQty: env.runtime.d2StepQty,
          }),
          stepQtyPct: liveRisk.d2StepQtyPct,
          targetProfitPct: liveRisk.d2TargetProfitPct,
          targetUserIds: [scope.userId],
          targetRunIds: [scope.runId],
          correlationIdOverride: correlationId,
          applyCapitalSplitSizing: false,
          d2DisplayStep: displayStep,
          d2StepLabel: d2StepLabel(displayStep),
        });
        if (clipRes.ok && clipRes.jobsEnqueued > 0) {
          parts.push(`hedge_L${displayStep}`);
        } else {
          tradingLog("warn", "ta_trend_arb_hedge_skip", {
            runId: scope.runId,
            step: displayStep,
            error: clipRes.ok ? "zero_jobs" : clipRes.error,
          });
        }
      }
    }

    return {
      primaryFlat: false,
      detail: parts.join("|") || `d1_open_urp_${urp.toFixed(2)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "ta_trend_arb_poll_exception", { runId: scope.runId, error: msg });
    return { primaryFlat: true, detail: `poll_exception:${msg}` };
  }
}

export async function pollTrendArbVirtualRiskAndHedges(params: {
  env: TrendArbitrageEnv;
  barTime: number;
  barClose: number;
}): Promise<{ detail: string }> {
  try {
    const parts = await monitorActiveVirtualRuns({
      env: params.env,
      barTime: params.barTime,
      markPrice: params.barClose,
    });
    return { detail: parts.join("|") || "virtual_monitor_ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "ta_trend_arb_virtual_poll_exception", { error: msg });
    return { detail: `virtual_poll_exception:${msg}` };
  }
}
