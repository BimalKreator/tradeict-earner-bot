/**
 * PM2-friendly entry: loads env then starts the RSI TA loop (non-blocking).
 */
import "dotenv/config";

import { startTaWorkerLoop } from "../server/trading/ta-worker";

startTaWorkerLoop();
