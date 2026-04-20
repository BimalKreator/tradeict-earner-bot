/**
 * Strategy signal intake — any number of strategies can publish conforming payloads.
 * Execution layer is responsible for fan-out to eligible user runs.
 */
export type StrategyExecutionSignal = {
  /** Target strategy (UUID). */
  strategyId: string;
  /** Stable id for this signal batch (dedupe jobs / trace). */
  correlationId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  /** Base sizing unit; per-user risk still capped by run settings downstream. */
  quantity: string;
  limitPrice?: string | null;
  /**
   * `entry` = open / add; `exit` = close / reduce. Omitted → treated as `entry`
   * in the execution layer (see `normalizeStrategySignalAction`).
   */
  actionType?: "entry" | "exit";
  /** Optional filter — omit to broadcast to all eligible subscribers (live + virtual). */
  targetUserIds?: string[];
  /**
   * Optional filter — only these `user_strategy_runs.id` values receive **live** jobs.
   * Does **not** filter `virtual_strategy_runs`; paper legs still fan out in parallel when eligible.
   */
  targetRunIds?: string[];
  /**
   * Which saved Delta connection receives the job for each run.
   * - `auto` — legacy behavior: COALESCE(primary, secondary, latest tested).
   * - `primary` — `user_strategy_runs.primary_exchange_connection_id`, or auto if unset.
   * - `secondary` — secondary only; runs without a secondary are skipped (0 jobs).
   */
  exchangeVenue?: "auto" | "primary" | "secondary";
  /**
   * Fan-out target mode:
   * - `both` (default): enqueue live + virtual eligible runs.
   * - `live_only`: enqueue only live (`user_strategy_runs`) jobs.
   * - `virtual_only`: enqueue only paper (`virtual_strategy_runs`) jobs.
   */
  executionMode?: "both" | "live_only" | "virtual_only";
  metadata?: Record<string, unknown>;
};

export type StrategySignalIntakeResult = {
  ok: true;
  jobsEnqueued: number;
  correlationId: string;
  /** Jobs with `executionMode: "live"` (subset of `jobsEnqueued`). */
  liveJobsEnqueued?: number;
  /** Jobs with `executionMode: "virtual"` (subset of `jobsEnqueued`). */
  virtualJobsEnqueued?: number;
};

export type StrategySignalIntakeError = {
  ok: false;
  error: string;
};

export type StrategySignalIntakeResponse =
  | StrategySignalIntakeResult
  | StrategySignalIntakeError;
