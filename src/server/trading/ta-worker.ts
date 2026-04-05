/**
 * Long-running native TA loop (RSI scalper). Does not start the Next.js server.
 *
 * Run: `npm run trading:ta-worker`
 *
 * Set `TA_RSI_SCALPER_ENABLED=true` and required env (see `.env.example`).
 */
import { readRsiScalperEnv, runRsiScalperShortOnce } from "./ta-engine/rsi-scalper";
import { tradingLog } from "./trading-log";

const INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.TA_RSI_SCALPER_INTERVAL_MS?.trim() || "60000") || 60_000,
);

async function tick(): Promise<void> {
  const parsed = readRsiScalperEnv();
  if (parsed.kind === "disabled") {
    return;
  }
  if (parsed.kind === "invalid") {
    tradingLog("error", "ta_worker_config_invalid", { error: parsed.error });
    return;
  }

  const r = await runRsiScalperShortOnce(parsed.config);
  if (!r.ok) {
    tradingLog("warn", "ta_worker_tick_failed", { error: r.error });
    return;
  }
  if (r.fired) {
    tradingLog("info", "ta_worker_tick_signal", {
      detail: r.detail,
      correlationId: r.correlationId,
    });
  }
}

export function startTaWorkerLoop(): NodeJS.Timeout {
  tradingLog("info", "ta_worker_started", { intervalMs: INTERVAL_MS });
  void tick();
  return setInterval(() => {
    void tick().catch((e) => {
      console.error("[ta-worker] tick error:", e);
    });
  }, INTERVAL_MS);
}
