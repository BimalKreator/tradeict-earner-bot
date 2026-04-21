import { contractsFromCollateralLeverageAndContractValue } from "@/server/exchange/delta-contract-sizing";
import { fetchDeltaIndiaProductContractValue } from "@/server/exchange/delta-product-resolver";

import {
  findEligibleRunsForStrategyExecution,
  type EligibleStrategyRunRow,
} from "./eligibility";
import { resolveFinalAllocatedCapitalUsd } from "./execution-preferences";
import { findEligibleVirtualRunsForStrategyExecution } from "./virtual-eligibility";
import { enqueueStrategySignalJobs } from "./execution-queue";
import { normalizeStrategySignalAction } from "./signal-action";
import type {
  StrategyExecutionSignal,
  StrategySignalIntakeResponse,
} from "./signals/types";
import { tradingLog } from "./trading-log";
import type { TradingExecutionJobPayload } from "@/server/db/schema";

function resolveLiveExchangeConnectionId(
  r: EligibleStrategyRunRow,
  venue: StrategyExecutionSignal["exchangeVenue"] | undefined,
): string | null {
  const v = venue ?? "auto";
  if (v === "secondary") {
    return r.secondaryExchangeConnectionId;
  }
  if (v === "primary") {
    return r.primaryExchangeConnectionId ?? r.exchangeConnectionId;
  }
  return r.exchangeConnectionId;
}

function resolveLiveExchangeConnectionIds(
  r: EligibleStrategyRunRow,
  signal: StrategyExecutionSignal,
): string[] {
  const hsLeg = resolveHedgeScalpingLegRouting(signal);
  if (hsLeg === "d1") {
    const primary = r.primaryExchangeConnectionId ?? r.exchangeConnectionId;
    if (!primary) {
      tradingLog("warn", "hs_live_route_missing_primary", {
        strategyId: signal.strategyId,
        runId: r.runId,
        userId: r.userId,
        correlationId: signal.correlationId,
      });
    }
    return primary ? [primary] : [];
  }
  if (hsLeg === "d2") {
    // Strict HS architecture: D2 must route to secondary only.
    if (!r.secondaryExchangeConnectionId) {
      tradingLog("warn", "hs_live_route_missing_secondary", {
        strategyId: signal.strategyId,
        runId: r.runId,
        userId: r.userId,
        correlationId: signal.correlationId,
      });
    }
    return r.secondaryExchangeConnectionId ? [r.secondaryExchangeConnectionId] : [];
  }

  const venue = signal.exchangeVenue;
  if (venue === "primary" || venue === "secondary") {
    const one = resolveLiveExchangeConnectionId(r, venue);
    return one ? [one] : [];
  }

  const md =
    signal.metadata && typeof signal.metadata === "object"
      ? (signal.metadata as Record<string, unknown>)
      : null;
  const fanoutAllRunVenues = md?.fanout_run_venues === true;
  if (!fanoutAllRunVenues) {
    const one = resolveLiveExchangeConnectionId(r, venue);
    return one ? [one] : [];
  }

  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (!id) return;
    if (!ids.includes(id)) ids.push(id);
  };
  add(r.primaryExchangeConnectionId);
  add(r.secondaryExchangeConnectionId);
  add(r.exchangeConnectionId);
  return ids;
}

function resolveHedgeScalpingLegRouting(
  signal: StrategyExecutionSignal,
): "d1" | "d2" | null {
  const md =
    signal.metadata && typeof signal.metadata === "object"
      ? (signal.metadata as Record<string, unknown>)
      : null;
  const source = typeof md?.source === "string" ? md.source.trim().toLowerCase() : "";
  if (source !== "hedge_scalping_poller") return null;

  const leg = typeof md?.leg === "string" ? md.leg.trim().toLowerCase() : "";
  if (leg.startsWith("d1")) return "d1";
  if (leg.startsWith("d2")) return "d2";

  const cid = signal.correlationId.trim().toLowerCase();
  if (cid.startsWith("hs_d1_")) return "d1";
  if (cid.startsWith("hs_d2_")) return "d2";
  return null;
}

function mergeSignalMetadata(
  signal: StrategyExecutionSignal,
): Record<string, unknown> {
  const base =
    signal.metadata && typeof signal.metadata === "object"
      ? { ...signal.metadata }
      : {};
  if (base.mark_price == null && base.markPrice != null) {
    base.mark_price = base.markPrice;
  }
  return base;
}

function shouldHonorIncomingSignalQuantity(params: {
  signalAction: "entry" | "exit";
  signalMetadata: Record<string, unknown>;
}): boolean {
  if (params.signalAction !== "entry") return true;
  const md = params.signalMetadata;
  if (md.force_signal_quantity === true) return true;
  if (md.explicit_leg_quantity === true) return true;
  const source = typeof md.source === "string" ? md.source.trim().toLowerCase() : "";
  if (source === "hedge_scalping_poller") return true;
  return false;
}

/**
 * Entry point for future strategy signal providers (cron, websocket, ML, etc.).
 *
 * **Live + virtual in parallel (no mutual exclusivity):**
 * - Eligible **live** rows (`user_strategy_runs` + subscription + Delta) and eligible **paper** rows
 *   (`virtual_strategy_runs`) are loaded in one `Promise.all` — neither branch short-circuits the other.
 * - One `INSERT` into `trading_execution_jobs` batches every payload; each job has its own row `id`.
 *   Workers claim with `FOR UPDATE SKIP LOCKED`, so live and virtual jobs never share a row lock.
 * - `targetRunIds` (if set) restricts **live** targets only; virtual fan-out still runs for all eligible paper runs.
 */
export async function dispatchStrategyExecutionSignal(
  signal: StrategyExecutionSignal,
): Promise<StrategySignalIntakeResponse> {
  if (!signal.strategyId || !signal.correlationId) {
    return { ok: false, error: "strategyId and correlationId are required." };
  }
  if (!signal.quantity?.trim()) {
    return { ok: false, error: "quantity is required." };
  }

  const signalAction = normalizeStrategySignalAction(signal);
  const signalMetadata = mergeSignalMetadata(signal);
  const mode = signal.executionMode ?? "both";
  const honorIncomingSignalQuantity = shouldHonorIncomingSignalQuantity({
    signalAction,
    signalMetadata,
  });

  const [liveRuns, virtualRuns] = await Promise.all([
    mode === "virtual_only"
      ? Promise.resolve([])
      : findEligibleRunsForStrategyExecution(signal.strategyId, {
          targetUserIds: signal.targetUserIds,
          targetRunIds: signal.targetRunIds,
          signalAction,
        }),
    mode === "live_only"
      ? Promise.resolve([])
      : findEligibleVirtualRunsForStrategyExecution(signal.strategyId, {
          targetUserIds: signal.targetUserIds,
          signalAction,
        }),
  ]);

  let contractValueUsd: number | null = null;
  if (signalAction === "entry" && liveRuns.length > 0) {
    try {
      contractValueUsd = await fetchDeltaIndiaProductContractValue(signal.symbol);
    } catch {
      contractValueUsd = null;
    }
  }

  const livePayloads: TradingExecutionJobPayload[] = [];
  for (const r of liveRuns) {
    const exchangeConnectionIds = resolveLiveExchangeConnectionIds(r, signal);
    if (exchangeConnectionIds.length === 0) continue;

    for (const exchangeConnectionId of exchangeConnectionIds) {
      let quantity = signal.quantity.trim();
      if (
        !honorIncomingSignalQuantity &&
        signalAction === "entry" &&
        contractValueUsd != null &&
        contractValueUsd > 0
      ) {
        const capitalUsd = resolveFinalAllocatedCapitalUsd({
          runSettingsJson: r.runSettingsJson,
          columnCapital: r.capitalToUseInr,
          recommendedCapitalInr: r.recommendedCapitalInr,
        });
        const lev = Number(r.leverage);
        if (
          capitalUsd != null &&
          capitalUsd > 0 &&
          Number.isFinite(lev) &&
          lev > 0
        ) {
          const contracts = contractsFromCollateralLeverageAndContractValue({
            collateralUsd: capitalUsd,
            leverage: lev,
            contractValueUsd,
          });
          if (contracts > 0) {
            quantity = String(contracts);
          }
        }
      }

      livePayloads.push({
        kind: "execute_strategy_signal",
        executionMode: "live",
        strategyId: signal.strategyId,
        correlationId: signal.correlationId,
        symbol: signal.symbol,
        side: signal.side,
        orderType: signal.orderType,
        quantity,
        limitPrice: signal.limitPrice ?? null,
        targetUserId: r.userId,
        subscriptionId: r.subscriptionId,
        runId: r.runId,
        exchangeConnectionId,
        leverage: r.leverage,
        signalAction,
        signalMetadata,
      });
    }
  }

  const virtualPayloads: TradingExecutionJobPayload[] = virtualRuns.map(
    (v) => ({
      kind: "execute_strategy_signal",
      executionMode: "virtual",
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
      symbol: signal.symbol,
      side: signal.side,
      orderType: signal.orderType,
      quantity: signal.quantity,
      limitPrice: signal.limitPrice ?? null,
      targetUserId: v.userId,
      virtualRunId: v.virtualRunId,
      signalAction,
      signalMetadata,
    }),
  );

  const payloads = [...livePayloads, ...virtualPayloads];

  if (payloads.length === 0) {
    tradingLog("info", "signal_dispatch_no_targets", {
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
    });
    return {
      ok: true,
      jobsEnqueued: 0,
      correlationId: signal.correlationId,
      liveJobsEnqueued: 0,
      virtualJobsEnqueued: 0,
    };
  }

  const n = await enqueueStrategySignalJobs(payloads);
  tradingLog("info", "signal_dispatch_enqueued", {
    strategyId: signal.strategyId,
    correlationId: signal.correlationId,
    jobsEnqueued: n,
    liveJobs: livePayloads.length,
    virtualJobs: virtualPayloads.length,
    parallelFanout: livePayloads.length > 0 && virtualPayloads.length > 0,
  });

  return {
    ok: true,
    jobsEnqueued: n,
    correlationId: signal.correlationId,
    liveJobsEnqueued: livePayloads.length,
    virtualJobsEnqueued: virtualPayloads.length,
  };
}
