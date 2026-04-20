import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  tradingExecutionJobs,
  type TradingExecutionJobPayload,
} from "@/server/db/schema";

function backoffMs(attempt: number): number {
  const base = 1000 * 2 ** Math.min(attempt, 8);
  return Math.min(base, 300_000);
}

/**
 * True if any row exists for this correlation id (any status).
 * Used by native TA workers to avoid enqueueing duplicate **waves** on repeated ticks.
 *
 * Note: One successful `dispatchStrategyExecutionSignal` intentionally inserts **multiple** job rows
 * (live + virtual, and one per eligible run) sharing the same `correlationId`. After that wave,
 * this function returns true so the provider does not enqueue a second wave for the same signal.
 */
export async function hasTradingJobForCorrelationId(
  correlationId: string,
): Promise<boolean> {
  if (!db) return false;
  const [row] = await db
    .select({ id: tradingExecutionJobs.id })
    .from(tradingExecutionJobs)
    .where(
      and(
        eq(tradingExecutionJobs.correlationId, correlationId),
        inArray(tradingExecutionJobs.status, ["pending", "processing", "completed"]),
      ),
    )
    .limit(1);
  return row != null;
}

/**
 * Any job row for this correlation (including failed/dead) — used to avoid enqueueing a second
 * Trend Arb initial D2 (s0) with the same id after a failed attempt, which would flatten D1 twice.
 */
export async function hasTradingJobRowForCorrelationId(correlationId: string): Promise<boolean> {
  if (!db) return false;
  const [row] = await db
    .select({ id: tradingExecutionJobs.id })
    .from(tradingExecutionJobs)
    .where(eq(tradingExecutionJobs.correlationId, correlationId))
    .limit(1);
  return row != null;
}

export async function getLatestTradingJobByCorrelationId(correlationId: string): Promise<{
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  updatedAt: Date;
  lastError: string | null;
} | null> {
  if (!db) return null;
  const [row] = await db
    .select({
      id: tradingExecutionJobs.id,
      status: tradingExecutionJobs.status,
      attempts: tradingExecutionJobs.attempts,
      maxAttempts: tradingExecutionJobs.maxAttempts,
      updatedAt: tradingExecutionJobs.updatedAt,
      lastError: tradingExecutionJobs.lastError,
    })
    .from(tradingExecutionJobs)
    .where(eq(tradingExecutionJobs.correlationId, correlationId))
    .orderBy(desc(tradingExecutionJobs.createdAt))
    .limit(1);
  if (!row) return null;
  return row;
}

/**
 * Inserts all payloads in a single statement so the wave is atomic: either every
 * live/virtual job row is created or none (Postgres multi-row insert).
 */
export async function enqueueStrategySignalJobs(
  payloads: TradingExecutionJobPayload[],
): Promise<number> {
  if (!db || payloads.length === 0) return 0;
  const now = new Date();
  await db.insert(tradingExecutionJobs).values(
    payloads.map((p) => ({
      jobKind: "execute_strategy_signal",
      correlationId: p.correlationId,
      status: "pending" as const,
      attempts: 0,
      maxAttempts: 5,
      runAt: now,
      payload: {
        ...p,
        executionMode: p.executionMode ?? "live",
      },
      updatedAt: now,
    })),
  );
  return payloads.length;
}

export type ClaimedTradingJob = {
  id: string;
  payload: TradingExecutionJobPayload;
  attempts: number;
  maxAttempts: number;
};

/**
 * Claims one due job using `FOR UPDATE SKIP LOCKED` (Postgres).
 */
export async function claimNextTradingJob(
  workerId: string,
): Promise<ClaimedTradingJob | null> {
  if (!db) return null;

  const q = await db.execute(sql`
    UPDATE trading_execution_jobs
    SET
      status = 'processing',
      locked_at = NOW(),
      locked_by = ${workerId},
      updated_at = NOW(),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM trading_execution_jobs
      WHERE status = 'pending'
        AND run_at <= NOW()
      ORDER BY
        run_at ASC,
        CASE WHEN payload->>'executionMode' = 'virtual' THEN 1 ELSE 0 END ASC,
        created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `);

  const rows = q as unknown as { id: string }[];
  const row = rows[0];
  if (!row?.id) return null;

  const [job] = await db
    .select({
      id: tradingExecutionJobs.id,
      payload: tradingExecutionJobs.payload,
      attempts: tradingExecutionJobs.attempts,
      maxAttempts: tradingExecutionJobs.maxAttempts,
    })
    .from(tradingExecutionJobs)
    .where(eq(tradingExecutionJobs.id, row.id))
    .limit(1);

  if (!job) return null;

  return {
    id: job.id,
    payload: job.payload as TradingExecutionJobPayload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  };
}

export async function completeTradingJob(jobId: string): Promise<void> {
  if (!db) return;
  const now = new Date();
  await db
    .update(tradingExecutionJobs)
    .set({
      status: "completed",
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(tradingExecutionJobs.id, jobId));
}

export async function failTradingJobRetryOrDead(
  jobId: string,
  attempts: number,
  maxAttempts: number,
  error: string,
): Promise<void> {
  if (!db) return;
  const now = new Date();
  if (attempts >= maxAttempts) {
    await db
      .update(tradingExecutionJobs)
      .set({
        status: "dead",
        lockedAt: null,
        lockedBy: null,
        lastError: error.slice(0, 2000),
        updatedAt: now,
      })
      .where(eq(tradingExecutionJobs.id, jobId));
    return;
  }

  const nextRun = new Date(Date.now() + backoffMs(attempts));
  await db
    .update(tradingExecutionJobs)
    .set({
      status: "pending",
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 2000),
      runAt: nextRun,
      updatedAt: now,
    })
    .where(eq(tradingExecutionJobs.id, jobId));
}

export async function countDueTradingJobs(): Promise<number> {
  if (!db) return 0;
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(tradingExecutionJobs)
    .where(
      and(
        eq(tradingExecutionJobs.status, "pending"),
        lte(tradingExecutionJobs.runAt, sql`NOW()`),
      ),
    );
  return Number(r?.c ?? 0);
}

/**
 * Requeues jobs stuck in `processing` beyond a lock timeout (worker crash/restart safety).
 */
export async function requeueStaleProcessingJobs(
  staleMs = 60_000,
): Promise<number> {
  if (!db) return 0;
  const seconds = Math.max(1, Math.floor(staleMs / 1000));
  const q = await db.execute(sql`
    UPDATE trading_execution_jobs
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = NOW(),
      last_error = COALESCE(last_error, 'requeued_stale_processing_lock')
    WHERE status = 'processing'
      AND locked_at IS NOT NULL
      AND locked_at <= NOW() - (${seconds} * INTERVAL '1 second')
    RETURNING id
  `);
  const rows = q as unknown as { id: string }[];
  return rows.length;
}
