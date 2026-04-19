import { and, asc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { isHedgeScalpingStrategySlug } from "@/lib/hedge-scalping-config";
import {
  classifyHedgeScalpingVirtualDualAccount,
  deriveLedgerMetrics,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import {
  botPositions,
  hedgeScalpingVirtualClips,
  hedgeScalpingVirtualRuns,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  virtualBotOrders,
  virtualStrategyRuns,
  type TradingExecutionJobPayload,
} from "@/server/db/schema";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";
import {
  applyHsVirtualBalanceDelta,
  hedgeLegGrossPnlUsd,
  hedgeVirtualRoundtripFeeUsd,
  insertHsVirtualFilledOrder,
  type HedgeScalpingDbTx,
} from "@/server/trading/hedge-scalping/virtual-integration";
import { dispatchStrategyExecutionSignal } from "@/server/trading/strategy-signal-dispatcher";
import { assertVirtualRunStillEligibleForExecution } from "@/server/trading/virtual-eligibility";
import { simulateVirtualOrder } from "@/server/trading/virtual-order-simulator";

export const dynamic = "force-dynamic";

const LOG_MANUAL = "[MANUAL CLOSE API]";

type CloseMode = "virtual" | "real";

function oppositeSideForNet(netQty: number): "buy" | "sell" {
  return netQty > 0 ? "sell" : "buy";
}

/** Hedge D1 entry correlation only: `hs_d1_<runId>` (not `hs_d1_exit_...`). */
function parseHsD1HedgeRunIdFromCorrelation(correlationId: string | null | undefined): string | null {
  const m = /^hs_d1_([0-9a-f-]{36})$/i.exec(correlationId ?? "");
  return m?.[1] ?? null;
}

function parseHedgeRunIdFromVirtualLedger(ledger: LedgerOrderRow[]): string | null {
  for (const o of ledger) {
    const id = parseHsD1HedgeRunIdFromCorrelation(o.correlationId);
    if (id) return id;
  }
  return null;
}

function mapRowsToLedger(
  orderRows: {
    symbol: string;
    side: string;
    quantity: string;
    fillPrice: string | null;
    status: string;
    correlationId: string | null;
    createdAt: Date;
  }[],
): LedgerOrderRow[] {
  return orderRows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    quantity: String(row.quantity),
    fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
    status: row.status,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  }));
}

async function loadVirtualLedger(
  client: Pick<NonNullable<typeof db>, "select">,
  virtualRunId: string,
): Promise<LedgerOrderRow[]> {
  const orderRows = await client
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
    .where(eq(virtualBotOrders.virtualRunId, virtualRunId))
    .orderBy(asc(virtualBotOrders.createdAt));
  return mapRowsToLedger(orderRows);
}

async function finalizeHedgeScalpingVirtualRunTx(
  tx: HedgeScalpingDbTx,
  params: { hedgeRunId: string; userId: string; strategyId: string },
): Promise<{ runs: number; clips: number }> {
  const now = new Date();
  const runRows = await tx
    .update(hedgeScalpingVirtualRuns)
    .set({ status: "completed", closedAt: now })
    .where(
      and(
        eq(hedgeScalpingVirtualRuns.runId, params.hedgeRunId),
        eq(hedgeScalpingVirtualRuns.userId, params.userId),
        eq(hedgeScalpingVirtualRuns.strategyId, params.strategyId),
        eq(hedgeScalpingVirtualRuns.status, "active"),
      ),
    )
    .returning({ runId: hedgeScalpingVirtualRuns.runId });
  const clipRows = await tx
    .update(hedgeScalpingVirtualClips)
    .set({ status: "completed", closedAt: now })
    .where(
      and(
        eq(hedgeScalpingVirtualClips.runId, params.hedgeRunId),
        eq(hedgeScalpingVirtualClips.status, "active"),
      ),
    )
    .returning({ clipId: hedgeScalpingVirtualClips.clipId });
  return { runs: runRows.length, clips: clipRows.length };
}

/**
 * Hedge scalping paper uses `insertHsVirtualFilledOrder` for HS fills (does not maintain
 * `open_net_qty` on `virtual_strategy_runs`). Manual close must insert D1/D2 exits and sync
 * aggregate qty in one DB transaction, then complete hedge rows so the poller cannot reopen.
 */
async function executeManualCloseHedgeScalpingVirtual(params: {
  run: {
    id: string;
    userId: string;
    strategyId: string;
    openSymbol: string | null;
  };
  eligRow: { userId: string; strategyId: string };
}): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: "no_database" };

  try {
    const ledgerPrefetch = await loadVirtualLedger(db, params.run.id);
    const d1Prefetch = deriveLedgerMetrics(
      ledgerPrefetch.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "primary"),
      null,
    );
    const d2Prefetch = deriveLedgerMetrics(
      ledgerPrefetch.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "secondary"),
      null,
    );

    console.log(
      `${LOG_MANUAL} hedge virtualRunId=${params.run.id} d1OpenQty=${d1Prefetch.openNetQty} d2OpenQty=${d2Prefetch.openNetQty}`,
    );

    if (Math.abs(d1Prefetch.openNetQty) < 1e-8 && Math.abs(d2Prefetch.openNetQty) < 1e-8) {
      await db.transaction(async (tx) => {
        const hedgeRunId = parseHedgeRunIdFromVirtualLedger(ledgerPrefetch);
        if (hedgeRunId) {
          const fin = await finalizeHedgeScalpingVirtualRunTx(tx, {
            hedgeRunId,
            userId: params.run.userId,
            strategyId: params.run.strategyId,
          });
          console.log(
            `${LOG_MANUAL} already_flat_ledger hedgeRunId=${hedgeRunId} hedge_runs_completed=${fin.runs} clips_completed=${fin.clips}`,
          );
        }
      });
      return { ok: true, closed: 0 };
    }

    const symD1 = d1Prefetch.openSymbol?.trim() || params.run.openSymbol?.trim() || "";
    const symD2 = d2Prefetch.openSymbol?.trim() || symD1;
    const markD1 =
      symD1.length > 0 ? await fetchDeltaIndiaTickerMarkPrice({ symbol: symD1 }) : null;
    const markD2 =
      symD2.length > 0 ? await fetchDeltaIndiaTickerMarkPrice({ symbol: symD2 }) : null;
    const pxD1 =
      markD1 != null && markD1 > 0 ? markD1 : markD2 != null && markD2 > 0 ? markD2 : null;
    const pxD2 =
      markD2 != null && markD2 > 0 ? markD2 : markD1 != null && markD1 > 0 ? markD1 : null;
    if (pxD1 == null || !(pxD1 > 0)) {
      return { ok: false, error: "virtual_mark_price_unavailable" };
    }

    const closedCount = await db.transaction(async (tx) => {
      let ledger = await loadVirtualLedger(tx, params.run.id);
      let d1Met = deriveLedgerMetrics(
        ledger.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "primary"),
        null,
      );
      let d2Met = deriveLedgerMetrics(
        ledger.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "secondary"),
        null,
      );

      let closed = 0;

      if (Math.abs(d1Met.openNetQty) > 1e-8 && symD1.length > 0) {
        const qty = Math.abs(d1Met.openNetQty);
        const side = oppositeSideForNet(d1Met.openNetQty);
        const entryPx = d1Met.avgEntryPrice != null && d1Met.avgEntryPrice > 0 ? d1Met.avgEntryPrice : pxD1;
        const d1SideH: "LONG" | "SHORT" = d1Met.openNetQty > 0 ? "LONG" : "SHORT";
        const gross = hedgeLegGrossPnlUsd({
          side: d1SideH,
          entryPrice: entryPx,
          exitPrice: pxD1,
          qty,
        });
        const fee = hedgeVirtualRoundtripFeeUsd(entryPx, pxD1, qty);
        const net = gross - fee;
        const correlationId = `manual_close_virtual_${params.run.id}_d1_${Date.now()}`;
        await insertHsVirtualFilledOrder(tx, {
          virtualPaperRunId: params.run.id,
          userId: params.eligRow.userId,
          strategyId: params.eligRow.strategyId,
          symbol: symD1,
          side,
          quantity: qty,
          fillPrice: pxD1,
          correlationId,
          signalAction: "exit",
          realizedPnlUsd: net,
        });
        await applyHsVirtualBalanceDelta(tx, params.run.id, net);
        closed += 1;
        console.log(
          `${LOG_MANUAL} inserted D1 exit correlationId=${correlationId} qty=${qty} side=${side} netUsd=${net.toFixed(4)}`,
        );
      }

      ledger = await loadVirtualLedger(tx, params.run.id);
      d1Met = deriveLedgerMetrics(
        ledger.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "primary"),
        null,
      );
      d2Met = deriveLedgerMetrics(
        ledger.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "secondary"),
        null,
      );

      if (Math.abs(d2Met.openNetQty) > 1e-8 && symD2.length > 0) {
        const px = pxD2 != null && pxD2 > 0 ? pxD2 : pxD1;
        const qty = Math.abs(d2Met.openNetQty);
        const side = oppositeSideForNet(d2Met.openNetQty);
        const entryPx = d2Met.avgEntryPrice != null && d2Met.avgEntryPrice > 0 ? d2Met.avgEntryPrice : px;
        const d2SideH: "LONG" | "SHORT" = d2Met.openNetQty > 0 ? "LONG" : "SHORT";
        const gross = hedgeLegGrossPnlUsd({
          side: d2SideH,
          entryPrice: entryPx,
          exitPrice: px,
          qty,
        });
        const fee = hedgeVirtualRoundtripFeeUsd(entryPx, px, qty);
        const net = gross - fee;
        const correlationId = `manual_close_virtual_${params.run.id}_d2_${Date.now()}`;
        await insertHsVirtualFilledOrder(tx, {
          virtualPaperRunId: params.run.id,
          userId: params.eligRow.userId,
          strategyId: params.eligRow.strategyId,
          symbol: symD2,
          side,
          quantity: qty,
          fillPrice: px,
          correlationId,
          signalAction: "exit",
          realizedPnlUsd: net,
        });
        await applyHsVirtualBalanceDelta(tx, params.run.id, net);
        closed += 1;
        console.log(
          `${LOG_MANUAL} inserted D2 exit correlationId=${correlationId} qty=${qty} side=${side} netUsd=${net.toFixed(4)}`,
        );
      }

      const ledFinal = await loadVirtualLedger(tx, params.run.id);
      const full = deriveLedgerMetrics(ledFinal, null);
      const now = new Date();
      await tx
        .update(virtualStrategyRuns)
        .set({
          openNetQty:
            Math.abs(full.openNetQty) < 1e-8 ? "0" : String(Number(full.openNetQty.toFixed(8))),
          openAvgEntryPrice:
            Math.abs(full.openNetQty) < 1e-8 || full.avgEntryPrice == null
              ? null
              : String(Number(full.avgEntryPrice.toFixed(8))),
          openSymbol: Math.abs(full.openNetQty) < 1e-8 ? null : full.openSymbol,
          updatedAt: now,
        })
        .where(eq(virtualStrategyRuns.id, params.run.id));

      console.log(
        `${LOG_MANUAL} synced virtual_strategy_runs openNetQty=${full.openNetQty} openSymbol=${full.openSymbol ?? "null"}`,
      );

      const hedgeRunId = parseHedgeRunIdFromVirtualLedger(ledFinal);
      if (hedgeRunId) {
        const fin = await finalizeHedgeScalpingVirtualRunTx(tx, {
          hedgeRunId,
          userId: params.run.userId,
          strategyId: params.run.strategyId,
        });
        console.log(
          `${LOG_MANUAL} hedge_scalping finalized hedgeRunId=${hedgeRunId} runs_rows=${fin.runs} clips_rows=${fin.clips}`,
        );
      } else {
        console.warn(`${LOG_MANUAL} no hs_d1 hedge run id parsed — hedge tables not updated`);
      }

      return closed;
    });
    return { ok: true, closed: closedCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_MANUAL} transaction_failed virtualRunId=${params.run.id} err=${msg.slice(0, 400)}`);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

async function closeVirtualRun(runId: string, requesterUserId: string, isAdmin: boolean) {
  if (!db) return { ok: false as const, error: "no_database" };
  const [run] = await db
    .select({
      id: virtualStrategyRuns.id,
      userId: virtualStrategyRuns.userId,
      strategyId: virtualStrategyRuns.strategyId,
      strategySlug: strategies.slug,
      openNetQty: virtualStrategyRuns.openNetQty,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(eq(virtualStrategyRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false as const, error: "virtual_run_not_found" };
  if (!isAdmin && run.userId !== requesterUserId) {
    return { ok: false as const, error: "forbidden" };
  }

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
    .where(eq(virtualBotOrders.virtualRunId, run.id))
    .orderBy(asc(virtualBotOrders.createdAt));

  const ledger = mapRowsToLedger(orderRows);
  const slug = run.strategySlug ?? "";

  if (isHedgeScalpingStrategySlug(slug)) {
    const elig = await assertVirtualRunStillEligibleForExecution(run.id, { signalAction: "exit" });
    if (!elig.ok) return { ok: false as const, error: `virtual_ineligible:${elig.reason}` };
    const hs = await executeManualCloseHedgeScalpingVirtual({
      run: {
        id: run.id,
        userId: run.userId,
        strategyId: run.strategyId,
        openSymbol: run.openSymbol,
      },
      eligRow: elig.row,
    });
    if (!hs.ok) return { ok: false as const, error: hs.error };
    return { ok: true as const, closed: hs.closed, detail: "virtual_closed_hedge_tx" };
  }

  const d1State = deriveLedgerMetrics(ledger, null);
  const d2State = deriveLedgerMetrics([], null);
  const legClosures = [
    {
      account: "D1" as const,
      netQty: d1State.openNetQty,
      symbol: d1State.openSymbol ?? run.openSymbol?.trim() ?? "",
    },
    {
      account: "D2" as const,
      netQty: d2State.openNetQty,
      symbol: d2State.openSymbol ?? "",
    },
  ].filter((leg) => Math.abs(leg.netQty) > 1e-8 && leg.symbol);

  if (legClosures.length === 0) {
    return { ok: true as const, closed: 0, detail: "already_flat" };
  }

  const elig = await assertVirtualRunStillEligibleForExecution(run.id, { signalAction: "exit" });
  if (!elig.ok) return { ok: false as const, error: `virtual_ineligible:${elig.reason}` };

  let closed = 0;
  for (const leg of legClosures) {
    const markPrice =
      (await fetchDeltaIndiaTickerMarkPrice({ symbol: leg.symbol })) ?? undefined;
    const payload: TradingExecutionJobPayload = {
      kind: "execute_strategy_signal",
      executionMode: "virtual",
      strategyId: run.strategyId,
      correlationId: `manual_close_virtual_${run.id}_${leg.account}_${Date.now()}`,
      symbol: leg.symbol,
      side: oppositeSideForNet(leg.netQty),
      orderType: "market",
      quantity: Math.abs(leg.netQty).toFixed(8),
      targetUserId: run.userId,
      virtualRunId: run.id,
      signalAction: "exit",
      signalMetadata: {
        source: "manual_close",
        close_all_legs: true,
        account: leg.account,
        ...(markPrice != null && markPrice > 0 ? { mark_price: markPrice } : {}),
      },
    };
    const sim = await simulateVirtualOrder({ payload, row: elig.row });
    if (!sim.ok) return { ok: false as const, error: sim.error };
    closed += 1;
  }
  return { ok: true as const, closed, detail: "virtual_closed" };
}

async function closeRealRun(runId: string, requesterUserId: string, isAdmin: boolean) {
  if (!db) return { ok: false as const, error: "no_database" };
  const [run] = await db
    .select({
      runId: userStrategyRuns.id,
      userId: userStrategySubscriptions.userId,
      strategyId: userStrategySubscriptions.strategyId,
      primaryEx: userStrategyRuns.primaryExchangeConnectionId,
      secondaryEx: userStrategyRuns.secondaryExchangeConnectionId,
      subscriptionId: userStrategyRuns.subscriptionId,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(eq(userStrategyRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false as const, error: "run_not_found" };
  if (!isAdmin && run.userId !== requesterUserId) {
    return { ok: false as const, error: "forbidden" };
  }

  const positions = await db
    .select({
      symbol: botPositions.symbol,
      netQty: botPositions.netQuantity,
      exchangeConnectionId: botPositions.exchangeConnectionId,
    })
    .from(botPositions)
    .where(
      and(
        eq(botPositions.subscriptionId, run.subscriptionId),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > 0.00000001`,
      ),
    );

  if (positions.length === 0) {
    return { ok: true as const, closed: 0, detail: "already_flat" };
  }

  let closed = 0;
  for (const p of positions) {
    const net = Number(p.netQty ?? "0");
    if (!(Math.abs(net) > 1e-8)) continue;
    const venue =
      p.exchangeConnectionId === run.secondaryEx
        ? "secondary"
        : p.exchangeConnectionId === run.primaryEx
          ? "primary"
          : "auto";
    const res = await dispatchStrategyExecutionSignal({
      strategyId: run.strategyId,
      correlationId: `manual_close_real_${runId}_${p.exchangeConnectionId}_${Date.now()}`,
      symbol: p.symbol,
      side: oppositeSideForNet(net),
      orderType: "market",
      quantity: Math.abs(net).toFixed(8),
      actionType: "exit",
      exchangeVenue: venue,
      targetUserIds: [run.userId],
      targetRunIds: [run.runId],
      metadata: {
        source: "manual_close",
        close_all_legs: true,
      },
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    closed += res.jobsEnqueued;
  }
  return { ok: true as const, closed, detail: "real_exit_jobs_dispatched" };
}

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const isAdmin = session.role === "admin";
  if (isAdmin) {
    const exists = await adminActiveRecordExists(session.userId);
    if (!exists) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    runId?: string;
    mode?: CloseMode;
  } | null;
  const runId = body?.runId?.trim() ?? "";
  const mode = body?.mode;
  if (!runId || (mode !== "virtual" && mode !== "real")) {
    return Response.json({ error: "runId and mode are required." }, { status: 400 });
  }

  const out =
    mode === "virtual"
      ? await closeVirtualRun(runId, session.userId, isAdmin)
      : await closeRealRun(runId, session.userId, isAdmin);
  if (!out.ok) return Response.json({ error: out.error }, { status: 400 });
  return Response.json(out);
}
