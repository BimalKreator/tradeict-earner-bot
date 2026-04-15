/**
 * PM2-friendly entry: Trend Arbitrage TA loop (multi-account skeleton).
 *
 * Run: `npm run trading:trend-arb-worker`
 *
 * Requires `TA_TREND_ARB_ENABLED=true`, `TA_TREND_ARB_STRATEGY_ID`, etc.
 */
import "dotenv/config";

import { startTrendArbWorkerLoop } from "../server/trading/ta-engine/trend-arbitrage";

startTrendArbWorkerLoop();
