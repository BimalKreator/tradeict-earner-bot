import {
  findEligibleRunsForStrategyExecution,
  type EligibleStrategyRunRow,
} from "./eligibility";
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

/**
 * Entry point for future strategy signal providers (cron, websocket, ML, etc.).
 * Fans out one durable job per eligible **live** user run and per eligible **virtual** run.
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

  const [liveRuns, virtualRuns] = await Promise.all([
    findEligibleRunsForStrategyExecution(signal.strategyId, {
      targetUserIds: signal.targetUserIds,
      targetRunIds: signal.targetRunIds,
      signalAction,
    }),
    findEligibleVirtualRunsForStrategyExecution(signal.strategyId, {
      targetUserIds: signal.targetUserIds,
      signalAction,
    }),
  ]);

  const venue = signal.exchangeVenue;
  const livePayloads: TradingExecutionJobPayload[] = [];
  for (const r of liveRuns) {
    const exchangeConnectionId = resolveLiveExchangeConnectionId(r, venue);
    if (exchangeConnectionId == null) continue;
    livePayloads.push({
      kind: "execute_strategy_signal",
      executionMode: "live",
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
      symbol: signal.symbol,
      side: signal.side,
      orderType: signal.orderType,
      quantity: signal.quantity,
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
    return { ok: true, jobsEnqueued: 0, correlationId: signal.correlationId };
  }

  const n = await enqueueStrategySignalJobs(payloads);
  tradingLog("info", "signal_dispatch_enqueued", {
    strategyId: signal.strategyId,
    correlationId: signal.correlationId,
    jobsEnqueued: n,
    liveJobs: livePayloads.length,
    virtualJobs: virtualPayloads.length,
  });

  return { ok: true, jobsEnqueued: n, correlationId: signal.correlationId };
}
