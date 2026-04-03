import { findEligibleRunsForStrategyExecution } from "./eligibility";
import { enqueueStrategySignalJobs } from "./execution-queue";
import type {
  StrategyExecutionSignal,
  StrategySignalIntakeResponse,
} from "./signals/types";
import { tradingLog } from "./trading-log";
import type { TradingExecutionJobPayload } from "@/server/db/schema";

/**
 * Entry point for future strategy signal providers (cron, websocket, ML, etc.).
 * Fans out one durable job per eligible user run.
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

  const runs = await findEligibleRunsForStrategyExecution(signal.strategyId, {
    targetUserIds: signal.targetUserIds,
  });

  if (runs.length === 0) {
    tradingLog("info", "signal_dispatch_no_targets", {
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
    });
    return { ok: true, jobsEnqueued: 0, correlationId: signal.correlationId };
  }

  const payloads: TradingExecutionJobPayload[] = runs.map((r) => ({
    kind: "execute_strategy_signal",
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
    signalMetadata: signal.metadata,
  }));

  const n = await enqueueStrategySignalJobs(payloads);
  tradingLog("info", "signal_dispatch_enqueued", {
    strategyId: signal.strategyId,
    correlationId: signal.correlationId,
    jobsEnqueued: n,
  });

  return { ok: true, jobsEnqueued: n, correlationId: signal.correlationId };
}
