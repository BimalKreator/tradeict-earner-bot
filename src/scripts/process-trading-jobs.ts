/**
 * Drain `trading_execution_jobs` (cron-friendly).
 * Usage: `npm run trading:worker`
 */
import "dotenv/config";

import { countDueTradingJobs } from "../server/trading/execution-queue";
import { runTradingWorkerBatch } from "../server/trading/execution-worker";
import { tradingLog } from "../server/trading/trading-log";

async function main() {
  const workerId = `worker_${process.pid}_${Date.now().toString(36)}`;
  const due = await countDueTradingJobs();
  tradingLog("info", "worker_batch_start", { workerId, due });

  const { completed } = await runTradingWorkerBatch(workerId, 50);
  tradingLog("info", "worker_batch_end", { workerId, completed });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
