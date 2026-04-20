/**
 * Drain `trading_execution_jobs` in a long-running loop (PM2-friendly).
 * Usage: `npm run trading:worker`
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  countDueTradingJobs,
  requeueStaleProcessingJobs,
} from "../server/trading/execution-queue";
import { runTradingWorkerBatch } from "../server/trading/execution-worker";
import { logLiveTradingModeWarningOnBoot } from "../server/trading/live-trading-boot-warning";
import { tradingLog } from "../server/trading/trading-log";

const LOOP_INTERVAL_MS = Math.max(500, Number(process.env.TRADING_WORKER_LOOP_MS ?? "1500") || 1500);
const BATCH_SIZE = Math.max(1, Number(process.env.TRADING_WORKER_BATCH_SIZE ?? "50") || 50);
const STALE_LOCK_MS = Math.max(
  LOOP_INTERVAL_MS * 2,
  Number(process.env.TRADING_WORKER_STALE_LOCK_MS ?? "60000") || 60_000,
);

let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countDueByMode(): Promise<{ liveDue: number; virtualDue: number }> {
  if (!db) return { liveDue: 0, virtualDue: 0 };
  const q = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN payload->>'executionMode' = 'live' THEN 1 ELSE 0 END), 0)::int AS live_due,
      COALESCE(SUM(CASE WHEN payload->>'executionMode' = 'virtual' THEN 1 ELSE 0 END), 0)::int AS virtual_due
    FROM trading_execution_jobs
    WHERE status = 'pending'
      AND run_at <= NOW()
  `);
  const rows = q as unknown as { live_due: number; virtual_due: number }[];
  const r = rows[0];
  return {
    liveDue: Number(r?.live_due ?? 0),
    virtualDue: Number(r?.virtual_due ?? 0),
  };
}

function installShutdownHooks(): void {
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    tradingLog("info", "worker_shutdown_signal", { signal });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

async function main() {
  logLiveTradingModeWarningOnBoot("trading_processor_boot");
  const workerId = `worker_${process.pid}_${Date.now().toString(36)}`;
  installShutdownHooks();
  console.log("[JOB-PROCESSOR] Listening for jobs...");
  tradingLog("info", "worker_loop_started", {
    workerId,
    intervalMs: LOOP_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    note: "Processes live jobs and virtual jobs (virtual-order-simulator path) from trading_execution_jobs.",
  });

  while (!stopping) {
    try {
      const recovered = await requeueStaleProcessingJobs(STALE_LOCK_MS);
      const due = await countDueTradingJobs();
      const dueAfterRecover = due;
      const { liveDue, virtualDue } = await countDueByMode();
      const { completed } = await runTradingWorkerBatch(workerId, BATCH_SIZE);
      tradingLog("info", "worker_batch_tick", {
        workerId,
        due,
        recoveredStaleProcessing: recovered,
        dueAfterRecover,
        liveDue,
        virtualDue,
        completed,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("error", "worker_batch_error", { workerId, error: msg });
    }
    if (!stopping) await sleep(LOOP_INTERVAL_MS);
  }

  tradingLog("info", "worker_loop_stopped", { workerId });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
