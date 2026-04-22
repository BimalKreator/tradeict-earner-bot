import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { isHedgeScalpingStrategySlug } from "@/lib/hedge-scalping-config";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { verifySessionToken } from "@/lib/session";
import {
  classifyHedgeScalpingVirtualDualAccount,
  deriveLedgerMetrics,
  isFilledOrder,
  type AccountKey,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import {
  botPositions,
  botOrders,
  exchangeConnections,
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
import { resolveExchangeTradingAdapter } from "@/server/trading/adapters/resolve-exchange-adapter";
import { dispatchStrategyExecutionSignal } from "@/server/trading/strategy-signal-dispatcher";
import { assertVirtualRunStillEligibleForExecution } from "@/server/trading/virtual-eligibility";
import { simulateVirtualOrder } from "@/server/trading/virtual-order-simulator";
import { tradingLog } from "@/server/trading/trading-log";
import {
  cancelAllTplLingeringOrders,
  extractTrendProfitLockRuntimeFromRunSettingsJson,
} from "@/server/trading/trend-profit-lock/cancel-tpl-lingering-orders";
import { logTplTradeExited } from "@/server/trading/tpl-trade-exit";

export const dynamic = "force-dynamic";

const LOG_MANUAL = "[MANUAL CLOSE API]";

type CloseMode = "virtual" | "real";

function oppositeSideForNet(netQty: number): "buy" | "sell" {
  return netQty > 0 ? "sell" : "buy";
}

function toWholeContractCloseQty(rawNetQty: number): number {
  const absNet = Math.abs(rawNetQty);
  if (!Number.isFinite(absNet) || absNet <= 0) return 0;
  return Math.floor(absNet);
}

function isTrendProfitLockSlug(slug: string | null | undefined): boolean {
  return (slug ?? "").toLowerCase().includes("trend-profit-lock");
}

function retainTrendProfitLockRuntimeMemoryFromRunSettingsJson(
  raw: unknown,
  lastTplTradeExitUi?: { reason: string; at: string; leg?: string },
): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const runtimeRaw =
    base.trendProfitLockRuntime &&
    typeof base.trendProfitLockRuntime === "object" &&
    !Array.isArray(base.trendProfitLockRuntime)
      ? { ...(base.trendProfitLockRuntime as Record<string, unknown>) }
      : {};
  const retainedRuntime: Record<string, unknown> = {
    d2StepsState: {},
    d2TriggeredSteps: [],
  };
  if (runtimeRaw.lastFlipCandleTime != null) {
    retainedRuntime.lastFlipCandleTime = runtimeRaw.lastFlipCandleTime;
  }
  if (runtimeRaw.lastCompletedD1FlipDirection != null) {
    retainedRuntime.lastCompletedD1FlipDirection =
      runtimeRaw.lastCompletedD1FlipDirection;
  }
  base.trendProfitLockRuntime = retainedRuntime;
  if (lastTplTradeExitUi) {
    base.lastTplTradeExitUi = lastTplTradeExitUi;
  }
  return base;
}

async function loadExchangeAdapterForConnection(exchangeConnectionId: string) {
  if (!db) return { ok: false as const, error: "no_database" };
  const [ec] = await db
    .select({
      provider: exchangeConnections.provider,
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
    .from(exchangeConnections)
    .where(eq(exchangeConnections.id, exchangeConnectionId))
    .limit(1);
  if (!ec) return { ok: false as const, error: "exchange_connection_not_found" };
  return resolveExchangeTradingAdapter({
    provider: ec.provider,
    apiKeyCiphertext: ec.apiKeyCiphertext,
    apiSecretCiphertext: ec.apiSecretCiphertext,
  });
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

async function resolveHedgeRunIdForFinalize(
  tx: HedgeScalpingDbTx,
  ledger: LedgerOrderRow[],
  userId: string,
  strategyId: string,
): Promise<string | null> {
  const fromLedger = parseHedgeRunIdFromVirtualLedger(ledger);
  if (fromLedger) return fromLedger;
  const [row] = await tx
    .select({ runId: hedgeScalpingVirtualRuns.runId })
    .from(hedgeScalpingVirtualRuns)
    .where(
      and(
        eq(hedgeScalpingVirtualRuns.userId, userId),
        eq(hedgeScalpingVirtualRuns.strategyId, strategyId),
        eq(hedgeScalpingVirtualRuns.status, "active"),
      ),
    )
    .limit(1);
  return row?.runId ?? null;
}

function lastPositiveFillPrice(ledger: LedgerOrderRow[], bucket: AccountKey): number | null {
  const rows = [...ledger]
    .filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === bucket)
    .filter((o) => isFilledOrder(o.status));
  for (let i = rows.length - 1; i >= 0; i--) {
    const o = rows[i]!;
    const p = o.fillPrice != null ? Number(String(o.fillPrice)) : NaN;
    if (Number.isFinite(p) && p > 0) return p;
  }
  return null;
}

/** Always resolves a valid exit price; never throws and never returns null. */
async function resolveManualCloseExitPx(params: {
  symbol: string | null;
  ledgerAvg: number | null;
  lastKnownMark: number | null;
  logLabel: string;
}): Promise<number> {
  let ticker: number | null = null;
  const sym = params.symbol?.trim();
  if (sym) {
    try {
      const px = await fetchDeltaIndiaTickerMarkPrice({ symbol: sym });
      if (px != null && Number.isFinite(px) && px > 0) {
        ticker = px;
      }
    } catch {
      ticker = null;
    }
  }

  const candidates = [
    ticker,
    params.ledgerAvg,
    params.lastKnownMark,
  ];
  for (const c of candidates) {
    if (c != null && Number.isFinite(c) && c > 0) return c;
  }
  console.warn(
    `${LOG_MANUAL} exit_px_fallback=1 label=${params.logLabel} (ticker and ledger marks unavailable)`,
  );
  return 1;
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

async function finalizeAllActiveHedgeScalpingVirtualRunsTx(
  tx: HedgeScalpingDbTx,
  params: { userId: string; strategyId: string },
): Promise<{ runs: number; clips: number }> {
  const now = new Date();
  const activeRuns = await tx
    .select({ runId: hedgeScalpingVirtualRuns.runId })
    .from(hedgeScalpingVirtualRuns)
    .where(
      and(
        eq(hedgeScalpingVirtualRuns.userId, params.userId),
        eq(hedgeScalpingVirtualRuns.strategyId, params.strategyId),
        eq(hedgeScalpingVirtualRuns.status, "active"),
      ),
    );
  const runIds = activeRuns.map((r) => r.runId);
  if (runIds.length === 0) return { runs: 0, clips: 0 };
  const runRows = await tx
    .update(hedgeScalpingVirtualRuns)
    .set({ status: "completed", closedAt: now })
    .where(
      and(
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
        inArray(hedgeScalpingVirtualClips.runId, runIds),
        eq(hedgeScalpingVirtualClips.status, "active"),
      ),
    )
    .returning({ clipId: hedgeScalpingVirtualClips.clipId });
  return { runs: runRows.length, clips: clipRows.length };
}

async function syncVirtualPaperRunFlatAfterManualCloseTx(
  tx: HedgeScalpingDbTx,
  virtualPaperRunId: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(virtualStrategyRuns)
    .set({
      openNetQty: "0",
      openAvgEntryPrice: null,
      openSymbol: null,
      virtualUsedMarginUsd: "0",
      updatedAt: now,
    })
    .where(eq(virtualStrategyRuns.id, virtualPaperRunId));
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
    openAvgEntryPrice: string | null;
  };
  eligRow: { userId: string; strategyId: string };
}): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: "no_database" };

  try {
    const ledgerPrefetch = await loadVirtualLedger(db, params.run.id);
    const exitSymbol =
      params.run.openSymbol?.trim() ||
      ledgerPrefetch.find((row) => row.symbol && row.symbol.trim().length > 0)?.symbol ||
      "BTCUSD";
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
        const hedgeRunId = await resolveHedgeRunIdForFinalize(
          tx,
          ledgerPrefetch,
          params.run.userId,
          params.run.strategyId,
        );
        if (hedgeRunId) {
          const fin = await finalizeHedgeScalpingVirtualRunTx(tx, {
            hedgeRunId,
            userId: params.run.userId,
            strategyId: params.run.strategyId,
          });
          console.log(
            `${LOG_MANUAL} already_flat_ledger hedgeRunId=${hedgeRunId} hedge_runs_completed=${fin.runs} clips_completed=${fin.clips}`,
          );
        } else {
          console.warn(`${LOG_MANUAL} already_flat_ledger — no hedge run id (ledger + DB lookup)`);
        }
        const finAll = await finalizeAllActiveHedgeScalpingVirtualRunsTx(tx, {
          userId: params.run.userId,
          strategyId: params.run.strategyId,
        });
        if (finAll.runs > 0 || finAll.clips > 0) {
          console.log(
            `${LOG_MANUAL} already_flat_ledger force_finalize_active_runs runs_rows=${finAll.runs} clips_rows=${finAll.clips}`,
          );
        }
        await syncVirtualPaperRunFlatAfterManualCloseTx(tx, params.run.id);
      });
      return { ok: true, closed: 0 };
    }

    const symD1 = d1Prefetch.openSymbol?.trim() || exitSymbol;
    const symD2 = d2Prefetch.openSymbol?.trim() || exitSymbol;
    const openAvgFromRun =
      params.run.openAvgEntryPrice != null && String(params.run.openAvgEntryPrice).trim() !== ""
        ? Number(String(params.run.openAvgEntryPrice).trim())
        : null;
    const runAvgOk =
      openAvgFromRun != null && Number.isFinite(openAvgFromRun) && openAvgFromRun > 0
        ? openAvgFromRun
        : null;

    const pxD1 = await resolveManualCloseExitPx({
      symbol: exitSymbol,
      ledgerAvg:
        d1Prefetch.avgEntryPrice != null && d1Prefetch.avgEntryPrice > 0
          ? d1Prefetch.avgEntryPrice
          : null,
      lastKnownMark:
        lastPositiveFillPrice(ledgerPrefetch, "primary") ??
        lastPositiveFillPrice(ledgerPrefetch, "secondary") ??
        runAvgOk,
      logLabel: "d1",
    });
    const pxD2 = await resolveManualCloseExitPx({
      symbol: exitSymbol,
      ledgerAvg:
        d2Prefetch.avgEntryPrice != null && d2Prefetch.avgEntryPrice > 0
          ? d2Prefetch.avgEntryPrice
          : null,
      lastKnownMark:
        lastPositiveFillPrice(ledgerPrefetch, "secondary") ??
        lastPositiveFillPrice(ledgerPrefetch, "primary") ??
        runAvgOk ??
        pxD1,
      logLabel: "d2",
    });

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

      if (Math.abs(d1Met.openNetQty) > 1e-8) {
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
          symbol: exitSymbol,
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

      if (Math.abs(d2Met.openNetQty) > 1e-8) {
        const px = pxD2 > 0 ? pxD2 : pxD1;
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
          symbol: exitSymbol,
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

      const hedgeRunId = await resolveHedgeRunIdForFinalize(
        tx,
        ledFinal,
        params.run.userId,
        params.run.strategyId,
      );
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
        console.warn(`${LOG_MANUAL} no hedge run id resolved — hedge_scalping_virtual_runs not finalized`);
      }
      const finAll = await finalizeAllActiveHedgeScalpingVirtualRunsTx(tx, {
        userId: params.run.userId,
        strategyId: params.run.strategyId,
      });
      if (finAll.runs > 0 || finAll.clips > 0) {
        console.log(
          `${LOG_MANUAL} hedge_scalping force_finalize_active_runs runs_rows=${finAll.runs} clips_rows=${finAll.clips}`,
        );
      }

      await syncVirtualPaperRunFlatAfterManualCloseTx(tx, params.run.id);
      console.log(
        `${LOG_MANUAL} virtual_strategy_runs kept active + flat open fields virtualRunId=${params.run.id}`,
      );

      return closed;
    });
    return { ok: true, closed: closedCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_MANUAL} transaction_failed virtualRunId=${params.run.id} err=${msg.slice(0, 400)}`);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

async function closeVirtualRun(
  runId: string,
  requesterUserId: string,
  isAdmin: boolean,
  requestId: string,
) {
  if (!db) return { ok: false as const, error: "no_database" };
  tradingLog("info", "manual_close_virtual_begin", {
    requestId,
    runId,
    requesterUserId,
    isAdmin,
  });
  const [run] = await db
    .select({
      id: virtualStrategyRuns.id,
      userId: virtualStrategyRuns.userId,
      strategyId: virtualStrategyRuns.strategyId,
      strategySlug: strategies.slug,
      openNetQty: virtualStrategyRuns.openNetQty,
      openSymbol: virtualStrategyRuns.openSymbol,
      openAvgEntryPrice: virtualStrategyRuns.openAvgEntryPrice,
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
    const elig = await assertVirtualRunStillEligibleForExecution(run.id, {
      signalAction: "exit",
      allowEmergencyExit: true,
    });
    if (!elig.ok) return { ok: false as const, error: `virtual_ineligible:${elig.reason}` };
    const hs = await executeManualCloseHedgeScalpingVirtual({
      run: {
        id: run.id,
        userId: run.userId,
        strategyId: run.strategyId,
        openSymbol: run.openSymbol,
        openAvgEntryPrice: run.openAvgEntryPrice,
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
    tradingLog("info", "manual_close_virtual_already_flat", {
      requestId,
      runId,
    });
    return { ok: true as const, closed: 0, detail: "already_flat" };
  }

  const elig = await assertVirtualRunStillEligibleForExecution(run.id, {
    signalAction: "exit",
    allowEmergencyExit: true,
  });
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
        manual_close_request_id: requestId,
        account: leg.account,
        ...(markPrice != null && markPrice > 0 ? { mark_price: markPrice } : {}),
      },
    };
    const sim = await simulateVirtualOrder({ payload, row: elig.row });
    if (!sim.ok) return { ok: false as const, error: sim.error };
    tradingLog("info", "manual_close_virtual_leg_simulated", {
      requestId,
      runId,
      account: leg.account,
      symbol: leg.symbol,
      qty: payload.quantity,
      side: payload.side,
    });
    closed += 1;
  }
  tradingLog("info", "manual_close_virtual_done", {
    requestId,
    runId,
    closed,
  });
  return { ok: true as const, closed, detail: "virtual_closed" };
}

async function resolveVenueSignedNetForManualClose(params: {
  exchangeConnectionId: string;
  symbol: string;
  localNet: number;
}): Promise<{ signedNet: number; source: "venue" | "local" }> {
  const adap = await loadExchangeAdapterForConnection(params.exchangeConnectionId);
  if (!adap.ok || !adap.adapter.fetchOpenPositions) {
    return { signedNet: params.localNet, source: "local" };
  }
  const snap = await adap.adapter.fetchOpenPositions({ symbols: [params.symbol] });
  if (!snap.ok) {
    tradingLog("warn", "manual_close_venue_qty_fetch_failed", {
      error: snap.error,
      symbol: params.symbol,
      exchangeConnectionId: params.exchangeConnectionId,
    });
    return { signedNet: params.localNet, source: "local" };
  }
  const symU = params.symbol.trim().toUpperCase();
  const row = snap.positions.find((x) => x.symbol.trim().toUpperCase() === symU);
  if (!row) {
    return { signedNet: 0, source: "venue" };
  }
  const ex = Number(row.netQty);
  if (!Number.isFinite(ex)) return { signedNet: params.localNet, source: "local" };
  return { signedNet: ex, source: "venue" };
}

async function closeRealRun(
  runId: string,
  requesterUserId: string,
  isAdmin: boolean,
  requestId: string,
) {
  if (!db) return { ok: false as const, error: "no_database" };
  tradingLog("info", "manual_close_real_begin", {
    requestId,
    runId,
    requesterUserId,
    isAdmin,
  });
  const [run] = await db
    .select({
      runId: userStrategyRuns.id,
      userId: userStrategySubscriptions.userId,
      strategyId: userStrategySubscriptions.strategyId,
      primaryEx: userStrategyRuns.primaryExchangeConnectionId,
      secondaryEx: userStrategyRuns.secondaryExchangeConnectionId,
      subscriptionId: userStrategyRuns.subscriptionId,
      runSettingsJson: userStrategyRuns.runSettingsJson,
      strategySlug: strategies.slug,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
    .where(eq(userStrategyRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false as const, error: "run_not_found" };
  if (!isAdmin && run.userId !== requesterUserId) {
    return { ok: false as const, error: "forbidden" };
  }

  if (isTrendProfitLockSlug(run.strategySlug)) {
    const parsed = parseUserStrategyRunSettingsJson(run.runSettingsJson);
    const rt =
      extractTrendProfitLockRuntimeFromRunSettingsJson(run.runSettingsJson) ??
      (parsed.trendProfitLockRuntime as Record<string, unknown> | undefined) ??
      null;
    const pAd = run.primaryEx ? await loadExchangeAdapterForConnection(run.primaryEx) : { ok: false as const, error: "no_primary" };
    const sAd = run.secondaryEx ? await loadExchangeAdapterForConnection(run.secondaryEx) : { ok: false as const, error: "no_secondary" };
    await cancelAllTplLingeringOrders({
      runtime: rt,
      primaryAdapter: pAd.ok ? pAd.adapter : null,
      secondaryAdapter: sAd.ok ? sAd.adapter : null,
      log: { requestId, runId, source: "manual_close_tpl_precheck" },
    });

    const symbolRows = await db
      .select({ symbol: botOrders.symbol })
      .from(botOrders)
      .where(
        and(
          eq(botOrders.runId, run.runId),
          inArray(botOrders.status, ["draft", "queued", "submitting", "open", "partial_fill"]),
        ),
      );
    const symbolSet = new Set<string>(
      symbolRows
        .map((r) => r.symbol.trim().toUpperCase())
        .filter((s) => s.length > 0),
    );
    for (const symbol of symbolSet) {
      if (pAd.ok && pAd.adapter.cancelAllConditionalOrdersForSymbol) {
        tradingLog("info", "tpl_force_cancel_all_orders_start", {
          requestId,
          runId,
          symbol,
          venue: "primary",
        });
        const out = await pAd.adapter.cancelAllConditionalOrdersForSymbol(symbol);
        tradingLog("info", "tpl_force_cancel_all_orders_result", {
          requestId,
          runId,
          symbol,
          venue: "primary",
          cancelResult: out,
        });
        tradingLog(out.ok ? "warn" : "error", "manual_close_tpl_cancel_all_symbol_conditionals", {
          requestId,
          runId,
          symbol,
          venue: "primary",
          ok: out.ok,
          cancelledCount: out.ok ? out.cancelledCount : 0,
          attemptedCount: out.ok ? out.attemptedCount : 0,
          error: out.ok ? null : out.error,
          raw: out.raw ?? null,
        });
      }
      if (sAd.ok && sAd.adapter.cancelAllConditionalOrdersForSymbol) {
        tradingLog("info", "tpl_force_cancel_all_orders_start", {
          requestId,
          runId,
          symbol,
          venue: "secondary",
        });
        const out = await sAd.adapter.cancelAllConditionalOrdersForSymbol(symbol);
        tradingLog("info", "tpl_force_cancel_all_orders_result", {
          requestId,
          runId,
          symbol,
          venue: "secondary",
          cancelResult: out,
        });
        tradingLog(out.ok ? "warn" : "error", "manual_close_tpl_cancel_all_symbol_conditionals", {
          requestId,
          runId,
          symbol,
          venue: "secondary",
          ok: out.ok,
          cancelledCount: out.ok ? out.cancelledCount : 0,
          attemptedCount: out.ok ? out.attemptedCount : 0,
          error: out.ok ? null : out.error,
          raw: out.raw ?? null,
        });
      }
    }
  }

  const positions = await db
    .select({
      id: botPositions.id,
      symbol: botPositions.symbol,
      netQty: botPositions.netQuantity,
      exchangeConnectionId: botPositions.exchangeConnectionId,
      metadata: botPositions.metadata,
    })
    .from(botPositions)
    .where(
      and(
        eq(botPositions.subscriptionId, run.subscriptionId),
        eq(botPositions.strategyId, run.strategyId),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > 0.00000001`,
      ),
    );

  if (positions.length === 0) {
    if (isTrendProfitLockSlug(run.strategySlug)) {
      const atIso = new Date().toISOString();
      await db
        .update(userStrategyRuns)
        .set({
          runSettingsJson: retainTrendProfitLockRuntimeMemoryFromRunSettingsJson(run.runSettingsJson, {
            reason: "manual_close",
            at: atIso,
            leg: "manual_close_api",
          }),
          updatedAt: new Date(),
        })
        .where(eq(userStrategyRuns.id, runId));
    }
    tradingLog("info", "manual_close_real_already_flat", {
      requestId,
      runId,
    });
    return { ok: true as const, closed: 0, detail: "already_flat" };
  }

  let closed = 0;
  let ghostFlushed = 0;
  for (const p of positions) {
    const localNet = Number(p.netQty ?? "0");
    if (!(Math.abs(localNet) > 1e-8)) continue;

    const { signedNet: net, source: qtySource } = await resolveVenueSignedNetForManualClose({
      exchangeConnectionId: p.exchangeConnectionId,
      symbol: p.symbol,
      localNet,
    });

    if (!(Math.abs(net) > 1e-8)) {
      const [lastFilled] = await db
        .select({
          filledQty: botOrders.filledQty,
          createdAt: botOrders.createdAt,
        })
        .from(botOrders)
        .where(
          and(
            eq(botOrders.subscriptionId, run.subscriptionId),
            eq(botOrders.strategyId, run.strategyId),
            eq(botOrders.exchangeConnectionId, p.exchangeConnectionId),
            eq(botOrders.symbol, p.symbol),
          ),
        )
        .orderBy(desc(botOrders.createdAt))
        .limit(1);
      await db
        .update(botPositions)
        .set({
          netQuantity: "0",
          averageEntryPrice: null,
          updatedAt: new Date(),
          metadata: {
            ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}),
            ghost_position_flushed_at: new Date().toISOString(),
            ghost_position_previous_net_qty: String(p.netQty ?? ""),
            ghost_position_flush_reason: "venue_flat_manual_close",
            ghost_position_qty_source: qtySource,
            ghost_position_last_filled_qty:
              lastFilled?.filledQty != null ? String(lastFilled.filledQty) : null,
          },
        })
        .where(eq(botPositions.id, p.id));
      ghostFlushed += 1;
      tradingLog("warn", "manual_close_real_ghost_flush_venue_flat", {
        requestId,
        runId,
        symbol: p.symbol,
        exchangeConnectionId: p.exchangeConnectionId,
        localNetQty: localNet,
        qtySource,
      });
      continue;
    }

    const wholeContracts = toWholeContractCloseQty(net);
    if (wholeContracts < 1) {
      const [lastFilled] = await db
        .select({
          filledQty: botOrders.filledQty,
          createdAt: botOrders.createdAt,
        })
        .from(botOrders)
        .where(
          and(
            eq(botOrders.subscriptionId, run.subscriptionId),
            eq(botOrders.strategyId, run.strategyId),
            eq(botOrders.exchangeConnectionId, p.exchangeConnectionId),
            eq(botOrders.symbol, p.symbol),
          ),
        )
        .orderBy(desc(botOrders.createdAt))
        .limit(1);
      await db
        .update(botPositions)
        .set({
          netQuantity: "0",
          averageEntryPrice: null,
          updatedAt: new Date(),
          metadata: {
            ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}),
            ghost_position_flushed_at: new Date().toISOString(),
            ghost_position_previous_net_qty: String(p.netQty ?? ""),
            ghost_position_last_filled_qty:
              lastFilled?.filledQty != null ? String(lastFilled.filledQty) : null,
          },
        })
        .where(eq(botPositions.id, p.id));
      ghostFlushed += 1;
      tradingLog("warn", "manual_close_real_too_small_flushed", {
        requestId,
        runId,
        symbol: p.symbol,
        exchangeConnectionId: p.exchangeConnectionId,
        netQty: net,
        detail: "position_too_small_to_close_on_delta",
        lastFilledQty: lastFilled?.filledQty ?? null,
      });
      continue;
    }
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
      quantity: String(wholeContracts),
      actionType: "exit",
      exchangeVenue: venue,
      targetUserIds: [run.userId],
      targetRunIds: [run.runId],
      metadata: {
        source: "manual_close",
        close_all_legs: true,
        manual_emergency_close: true,
        manual_close_request_id: requestId,
        venue_qty_source: qtySource,
      },
    });
    if (!res.ok) {
      tradingLog("error", "manual_close_real_dispatch_failed", {
        requestId,
        runId,
        symbol: p.symbol,
        exchangeConnectionId: p.exchangeConnectionId,
        error: res.error,
      });
      return { ok: false as const, error: res.error };
    }
    tradingLog("info", "manual_close_real_dispatch_ok", {
      requestId,
      runId,
      symbol: p.symbol,
      exchangeConnectionId: p.exchangeConnectionId,
      venue,
      netQty: net,
      closeContracts: wholeContracts,
      jobsEnqueued: res.jobsEnqueued,
      liveJobsEnqueued: res.liveJobsEnqueued ?? 0,
      virtualJobsEnqueued: res.virtualJobsEnqueued ?? 0,
      qtySource,
      correlationId: `manual_close_real_${runId}_${p.exchangeConnectionId}_*`,
    });
    closed += res.jobsEnqueued;
  }

  if (isTrendProfitLockSlug(run.strategySlug)) {
    const exitReason = closed === 0 && ghostFlushed > 0 ? "venue_flat_manual_close" : "manual_close";
    const atIso = new Date().toISOString();
    await db
      .update(userStrategyRuns)
      .set({
        runSettingsJson: retainTrendProfitLockRuntimeMemoryFromRunSettingsJson(run.runSettingsJson, {
          reason: exitReason,
          at: atIso,
          leg: "manual_close_api",
        }),
        updatedAt: new Date(),
      })
      .where(eq(userStrategyRuns.id, run.runId));
    logTplTradeExited({
      reason: exitReason,
      runId,
      userId: run.userId,
      strategyId: run.strategyId,
      leg: "manual_close_api",
      extra: { requestId, closed, ghostFlushed },
    });
  }

  tradingLog("info", "manual_close_real_done", {
    requestId,
    runId,
    closed,
    ghostFlushed,
  });
  return {
    ok: true as const,
    closed,
    detail: ghostFlushed > 0 ? "real_exit_jobs_dispatched_with_ghost_flush" : "real_exit_jobs_dispatched",
  };
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
  const requestId = `mc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  tradingLog("info", "manual_close_request_received", {
    requestId,
    requesterUserId: session.userId,
    role: session.role,
    runId,
    mode: mode ?? null,
  });
  if (!runId || (mode !== "virtual" && mode !== "real")) {
    tradingLog("warn", "manual_close_request_invalid", {
      requestId,
      runId,
      mode: mode ?? null,
    });
    return Response.json({ error: "runId and mode are required.", requestId }, { status: 400 });
  }

  const out = mode === "virtual"
    ? await closeVirtualRun(runId, session.userId, isAdmin, requestId)
    : await closeRealRun(runId, session.userId, isAdmin, requestId);
  if (!out.ok) {
    tradingLog("error", "manual_close_request_failed", {
      requestId,
      runId,
      mode,
      error: out.error,
    });
    return Response.json({ error: out.error, requestId }, { status: 400 });
  }
  tradingLog("info", "manual_close_request_succeeded", {
    requestId,
    runId,
    mode,
    closed: out.closed,
    detail: out.detail,
  });
  return Response.json({ ...out, requestId });
}
