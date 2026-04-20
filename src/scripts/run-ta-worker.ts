/**
 * PM2-friendly entry: loads env then starts the RSI TA loop (non-blocking).
 */
import "dotenv/config";

import { logLiveTradingModeWarningOnBoot } from "../server/trading/live-trading-boot-warning";
import { startTaWorkerLoop } from "../server/trading/ta-worker";

logLiveTradingModeWarningOnBoot("ta_worker_boot");
startTaWorkerLoop();
