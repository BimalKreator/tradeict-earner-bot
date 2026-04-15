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
  /** Optional filter — omit to broadcast to all eligible subscribers. */
  targetUserIds?: string[];
  /** Optional filter — only these `user_strategy_runs.id` values receive live jobs. */
  targetRunIds?: string[];
  /**
   * Which saved Delta connection receives the job for each run.
   * - `auto` — legacy behavior: COALESCE(primary, secondary, latest tested).
   * - `primary` — `user_strategy_runs.primary_exchange_connection_id`, or auto if unset.
   * - `secondary` — secondary only; runs without a secondary are skipped (0 jobs).
   */
  exchangeVenue?: "auto" | "primary" | "secondary";
  metadata?: Record<string, unknown>;
};

export type StrategySignalIntakeResult = {
  ok: true;
  jobsEnqueued: number;
  correlationId: string;
};

export type StrategySignalIntakeError = {
  ok: false;
  error: string;
};

export type StrategySignalIntakeResponse =
  | StrategySignalIntakeResult
  | StrategySignalIntakeError;
