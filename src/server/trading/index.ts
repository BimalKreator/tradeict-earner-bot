/**
 * Trading engine foundation — strategy signals, eligibility, queue, adapters, orders, positions.
 * Run `npm run trading:worker` to drain `trading_execution_jobs`.
 */

export { dispatchStrategyExecutionSignal } from "./strategy-signal-dispatcher";
export { runTradingWorkerBatch, processOneTradingJob } from "./execution-worker";
export { findEligibleRunsForStrategyExecution, assertRunStillEligibleForExecution } from "./eligibility";
export { countDueTradingJobs, enqueueStrategySignalJobs } from "./execution-queue";
export { generateSignalCorrelationId, generateInternalClientOrderId } from "./ids";
export type { StrategyExecutionSignal, StrategySignalIntakeResponse } from "./signals/types";
export type { ExchangeTradingAdapter } from "./adapters/exchange-adapter-types";
export { MockExchangeAdapter } from "./adapters/mock-exchange-adapter";
export { DeltaIndiaTradingAdapter } from "./adapters/delta-india-trading-adapter";
