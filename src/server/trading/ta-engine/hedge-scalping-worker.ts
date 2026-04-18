import { pollHedgeScalpingVirtualTrades } from "../hedge-scalping/poller";
import { tradingLog } from "../trading-log";
import {
  computeChartLookbackSeconds,
  filterClosedCandles,
  resolutionToSeconds,
  TA_CHART_TARGET_CLOSED_BARS,
  type OhlcvCandle,
} from "./rsi-scalper";
import {
  ensureHedgeScalpingLiveFeed,
  getHedgeScalpingLiveSnapshot,
  subscribeHedgeScalpingLiveTicks,
} from "./hedge-scalping-live-feed";

export type HedgeScalpingWorkerEnv = {
  enabled: boolean;
  symbol: string;
  baseUrl: string;
  resolution: string;
  lookbackSec: number;
};

export type ReadHedgeScalpingWorkerEnvResult =
  | { kind: "disabled" }
  | { kind: "ok"; config: HedgeScalpingWorkerEnv }
  | { kind: "invalid"; error: string };

export function readHedgeScalpingWorkerEnv(): ReadHedgeScalpingWorkerEnvResult {
  const raw = (process.env.HS_WORKER_ENABLED ?? "").trim().toLowerCase();
  const explicitlyDisabled =
    raw === "false" || raw === "0" || raw === "no" || raw === "off";
  if (explicitlyDisabled) return { kind: "disabled" };
  const baseUrl =
    process.env.HS_WORKER_DELTA_BASE_URL?.trim() || "https://api.india.delta.exchange";
  const symbol = process.env.HS_WORKER_SYMBOL?.trim() || "BTCUSD";
  const resolution = process.env.HS_WORKER_RESOLUTION?.trim() || "5m";
  const lookbackSec =
    Number(process.env.HS_WORKER_LOOKBACK_SEC?.trim() || "172800") || 172_800;
  if (!symbol) return { kind: "invalid", error: "HS_WORKER_SYMBOL is empty." };
  return {
    kind: "ok",
    config: { enabled: true, symbol, baseUrl, resolution, lookbackSec },
  };
}

export type HedgeScalpingWorkerTickResult =
  | { ok: true; detail: string; candles?: OhlcvCandle[]; livePrice?: number | null }
  | { ok: false; error: string };

/**
 * Refresh Delta candle snapshot and live mark, then run hedge-scalping virtual poller.
 */
export async function runHedgeScalpingWorkerOnce(
  env?: HedgeScalpingWorkerEnv,
): Promise<HedgeScalpingWorkerTickResult> {
  let c: HedgeScalpingWorkerEnv;
  if (env) {
    c = env;
  } else {
    const parsed = readHedgeScalpingWorkerEnv();
    if (parsed.kind === "disabled") {
      return {
        ok: true,
        detail: "HS_WORKER_ENABLED is false/0/no/off — hedge scalping worker ticks are skipped.",
      };
    }
    if (parsed.kind === "invalid") {
      return { ok: false, error: parsed.error };
    }
    c = parsed.config;
  }

  const resSec = resolutionToSeconds(c.resolution);
  const minHistorySec = computeChartLookbackSeconds(resSec, TA_CHART_TARGET_CLOSED_BARS);
  const lookbackSec = Math.max(c.lookbackSec, minHistorySec);

  let candles: OhlcvCandle[];
  let livePrice: number | null = null;
  try {
    await ensureHedgeScalpingLiveFeed({
      baseUrl: c.baseUrl,
      symbol: c.symbol,
      resolution: c.resolution,
      lookbackSec,
    });
    const snapshot = getHedgeScalpingLiveSnapshot({
      symbol: c.symbol,
      resolution: c.resolution,
    });
    if (snapshot && snapshot.candles.length > 0) {
      candles = snapshot.candles;
      livePrice = snapshot.lastPrice;
    } else {
      return { ok: true, detail: "Waiting for candle feed snapshot." };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "hs_worker_candles_failed", { error: msg });
    return { ok: false, error: msg };
  }

  const closed = filterClosedCandles(candles, resSec);
  const minBars = Math.max(TA_CHART_TARGET_CLOSED_BARS, 50);
  if (closed.length < minBars) {
    return {
      ok: true,
      detail: `Not enough closed candles (${closed.length}, need ${minBars}).`,
      candles,
      livePrice,
    };
  }

  const bar = candles[candles.length - 1]!;
  const barCloseLive =
    livePrice != null && Number.isFinite(livePrice) && livePrice > 0 ? livePrice : bar.close;

  try {
    await pollHedgeScalpingVirtualTrades(candles, barCloseLive);
  } catch (error) {
    console.error("[HS-POLLER-ERROR]", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: true,
    detail: `Polled hedge scalping @ ${c.symbol} ${c.resolution} (${candles.length} bars, mark=${barCloseLive}).`,
    candles,
    livePrice: barCloseLive,
  };
}

export function startHedgeScalpingWorkerLoop(): NodeJS.Timeout {
  console.log("[HS-WORKER] Engine started successfully at " + new Date().toISOString());

  const INTERVAL_MS = Math.max(
    10_000,
    Number(process.env.HS_WORKER_INTERVAL_MS?.trim() || "60000") || 60_000,
  );
  tradingLog("info", "hs_worker_started", { intervalMs: INTERVAL_MS });

  const envRes = readHedgeScalpingWorkerEnv();
  if (envRes.kind === "disabled") {
    console.log(
      "[HS-WORKER] Disabled by env — HS_WORKER_ENABLED is false, 0, no, or off (unset or true runs the worker).",
    );
  } else if (envRes.kind === "invalid") {
    console.log("[HS-WORKER] Invalid env: " + envRes.error);
  }

  let running = false;
  const runOnceSafe = () => {
    if (envRes.kind !== "ok") return;
    console.log("[HS-WORKER] Heartbeat tick for symbol: " + envRes.config.symbol);
    if (running) return;
    running = true;
    void runHedgeScalpingWorkerOnce(envRes.config)
      .catch((e) => {
        console.error("[hedge-scalping-worker] tick:", e);
      })
      .finally(() => {
        running = false;
      });
  };

  void (async () => {
    if (envRes.kind === "ok") {
      const resSec = resolutionToSeconds(envRes.config.resolution);
      await ensureHedgeScalpingLiveFeed({
        symbol: envRes.config.symbol,
        resolution: envRes.config.resolution,
        baseUrl: envRes.config.baseUrl,
        lookbackSec: Math.max(
          envRes.config.lookbackSec,
          computeChartLookbackSeconds(resSec, TA_CHART_TARGET_CLOSED_BARS),
        ),
      });
      subscribeHedgeScalpingLiveTicks({
        symbol: envRes.config.symbol,
        resolution: envRes.config.resolution,
        onTick: runOnceSafe,
      });
    }
    runOnceSafe();
  })();

  return setInterval(runOnceSafe, INTERVAL_MS);
}
