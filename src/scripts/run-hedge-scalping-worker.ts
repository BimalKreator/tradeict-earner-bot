/**
 * PM2-friendly entry: Hedge Scalping chart feed + virtual poller.
 *
 * Run: `npm run trading:hedge-scalping-worker`
 *
 * Runs by default; set `HS_WORKER_ENABLED=false` (or `0` / `no` / `off`) to disable.
 * Optional symbol/resolution via `HS_WORKER_*`.
 */
import "dotenv/config";

import { logLiveTradingModeWarningOnBoot } from "../server/trading/live-trading-boot-warning";
import { startHedgeScalpingWorkerLoop } from "../server/trading/ta-engine/hedge-scalping-worker";

logLiveTradingModeWarningOnBoot("hedge_scalping_worker_boot");
console.log("[hedge-scalping-worker] Boot — Delta candles + mark → pollHedgeScalpingVirtualTrades");

startHedgeScalpingWorkerLoop();
