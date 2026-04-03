import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  tradingExecutionJobs,
  type TradingExecutionJobPayload,
} from "@/server/db/schema";

function backoffMs(attempt: number): number {
  const base = 1000 * 2 ** Math.min(attempt, 8);
  return Math.min(base, 300_000);
}

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
      payload: p,
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
      ORDER BY run_at ASC
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
        lte(tradingExecutionJobs.runAt, new Date()),
      ),
    );
  return Number(r?.c ?? 0);
}
