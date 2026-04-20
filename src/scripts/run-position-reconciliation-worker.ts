import "dotenv/config";

import { logLiveTradingModeWarningOnBoot } from "../server/trading/live-trading-boot-warning";
import { runLivePositionReconciliationOnce } from "../server/trading/position-reconciliation";

const LOOP_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.POSITION_RECONCILIATION_INTERVAL_MS ?? "300000") || 300_000,
);

let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installShutdownHooks(): void {
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function main() {
  logLiveTradingModeWarningOnBoot("position_reconciliation_worker_boot");
  installShutdownHooks();
  console.log(`[position-reconciliation] Boot interval_ms=${LOOP_INTERVAL_MS}`);

  while (!stopping) {
    try {
      const out = await runLivePositionReconciliationOnce();
      console.log(
        `[position-reconciliation] ok checked=${out.checkedConnections} failed=${out.failedConnections} snapshots=${out.snapshotsWritten} at=${out.reconciledAt}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[position-reconciliation] failed err=${msg}`);
    }
    if (!stopping) await sleep(LOOP_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
