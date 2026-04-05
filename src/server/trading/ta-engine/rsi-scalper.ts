import { RSI } from "technicalindicators";

import { hasTradingJobForCorrelationId } from "../execution-queue";
import { dispatchStrategyExecutionSignal } from "../strategy-signal-dispatcher";
import { tradingLog } from "../trading-log";
import type { StrategySignalIntakeResponse } from "../signals/types";

/** When `jobsEnqueued === 0`, no DB row exists; avoid repeating dispatch for the same bar until it ages out. */
const zeroJobCorrelationMemory = new Map<string, number>();
const ZERO_JOB_TTL_MS = 86_400_000;

function wasZeroJobCorrelationRecently(correlationId: string): boolean {
  const ts = zeroJobCorrelationMemory.get(correlationId);
  if (ts == null) return false;
  if (Date.now() - ts > ZERO_JOB_TTL_MS) {
    zeroJobCorrelationMemory.delete(correlationId);
    return false;
  }
  return true;
}

function rememberZeroJobCorrelation(correlationId: string): void {
  zeroJobCorrelationMemory.set(correlationId, Date.now());
  if (zeroJobCorrelationMemory.size > 2000) {
    const now = Date.now();
    for (const [k, t] of zeroJobCorrelationMemory) {
      if (now - t > ZERO_JOB_TTL_MS) zeroJobCorrelationMemory.delete(k);
    }
  }
}

export type OhlcvCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function resolutionToSeconds(resolution: string): number {
  const r = resolution.trim().toLowerCase();
  const m = r.match(/^(\d+)(m|h|d|w)$/);
  if (!m) return 300;
  const n = Number(m[1]);
  const u = m[2];
  const mult =
    u === "m" ? 60 : u === "h" ? 3600 : u === "d" ? 86400 : 604800;
  return n * mult;
}

/**
 * Delta Exchange public REST — `GET /v2/history/candles` (no auth).
 * @see https://docs.delta.exchange/#get-historical-candles
 */
export async function fetchDeltaExchangeCandles(params: {
  baseUrl: string;
  symbol: string;
  resolution: string;
  lookbackSec: number;
}): Promise<OhlcvCandle[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - params.lookbackSec;
  const base = params.baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}/v2/history/candles`);
  url.searchParams.set("resolution", params.resolution);
  url.searchParams.set("symbol", params.symbol);
  url.searchParams.set("start", String(start));
  url.searchParams.set("end", String(end));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `delta_candles_http_${res.status}: ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    success?: boolean;
    result?: unknown;
  };

  const rows = json.result;
  if (!Array.isArray(rows)) {
    throw new Error("delta_candles_invalid_shape");
  }

  const out: OhlcvCandle[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const time = Number(o.time);
    const open = Number(o.open);
    const high = Number(o.high);
    const low = Number(o.low);
    const close = Number(o.close);
    const volume = Number(o.volume);
    if (
      [time, open, high, low, close, volume].some(
        (x) => typeof x !== "number" || !Number.isFinite(x),
      )
    ) {
      continue;
    }
    out.push({ time, open, high, low, close, volume });
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Keep only fully closed candles (exclude the bar still forming). */
export function filterClosedCandles(
  candles: OhlcvCandle[],
  resolutionSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): OhlcvCandle[] {
  return candles.filter((c) => c.time + resolutionSec <= nowSec);
}

/**
 * Bearish candle with upper wick strictly larger than the body (user rule).
 */
export function isBearishUpperWickGreaterThanBody(c: OhlcvCandle): boolean {
  if (!(c.close < c.open)) return false;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  return upperWick > body;
}

export type RsiScalperEnv = {
  enabled: boolean;
  strategyId: string;
  symbol: string;
  quantity: string;
  baseUrl: string;
  resolution: string;
  rsiPeriod: number;
  rsiLevel: number;
  /** Extra history for RSI warm-up */
  lookbackSec: number;
};

export type ReadRsiScalperEnvResult =
  | { kind: "disabled" }
  | { kind: "invalid"; error: string }
  | { kind: "ok"; config: RsiScalperEnv };

export function readRsiScalperEnv(): ReadRsiScalperEnvResult {
  const enabled = process.env.TA_RSI_SCALPER_ENABLED?.trim() === "true";
  const strategyId = process.env.TA_RSI_SCALPER_STRATEGY_ID?.trim() ?? "";
  const quantity = process.env.TA_RSI_SCALPER_QUANTITY?.trim() ?? "";
  const symbol =
    process.env.TA_RSI_SCALPER_SYMBOL?.trim() || "BTC_USDT";
  const baseUrl =
    process.env.TA_RSI_SCALPER_DELTA_BASE_URL?.trim() ||
    "https://api.delta.exchange";
  const resolution =
    process.env.TA_RSI_SCALPER_RESOLUTION?.trim() || "5m";
  const rsiPeriod = Math.max(
    2,
    Number(process.env.TA_RSI_SCALPER_RSI_PERIOD?.trim() || "14") || 14,
  );
  const rsiLevel = Number(process.env.TA_RSI_SCALPER_RSI_LEVEL?.trim() || "70");
  const lookbackSec = Math.max(
    36_000,
    Number(process.env.TA_RSI_SCALPER_LOOKBACK_SEC?.trim() || "172800") ||
      172_800,
  );

  if (!enabled) {
    return { kind: "disabled" };
  }
  if (!strategyId) {
    return {
      kind: "invalid",
      error: "TA_RSI_SCALPER_STRATEGY_ID is required.",
    };
  }
  if (!quantity) {
    return {
      kind: "invalid",
      error: "TA_RSI_SCALPER_QUANTITY is required.",
    };
  }
  if (!Number.isFinite(rsiLevel)) {
    return { kind: "invalid", error: "TA_RSI_SCALPER_RSI_LEVEL must be numeric." };
  }

  return {
    kind: "ok",
    config: {
      enabled: true,
      strategyId,
      symbol,
      quantity,
      baseUrl,
      resolution,
      rsiPeriod,
      rsiLevel,
      lookbackSec,
    },
  };
}

export type RsiScalperShortResult =
  | {
      ok: true;
      fired: boolean;
      correlationId?: string;
      dispatch?: StrategySignalIntakeResponse;
      detail: string;
      metadata?: Record<string, unknown>;
    }
  | { ok: false; error: string };

/**
 * Short entry when RSI crosses **below** `rsiLevel` on the latest **closed** bar,
 * and that bar is bearish with upper wick greater than body size.
 * Dispatches through `dispatchStrategyExecutionSignal` (same path as future webhooks).
 */
export async function runRsiScalperShortOnce(
  env?: RsiScalperEnv,
): Promise<RsiScalperShortResult> {
  let c: RsiScalperEnv;
  if (env) {
    c = env;
  } else {
    const parsed = readRsiScalperEnv();
    if (parsed.kind === "disabled") {
      return {
        ok: true,
        fired: false,
        detail: "TA_RSI_SCALPER_ENABLED is not true.",
      };
    }
    if (parsed.kind === "invalid") {
      return { ok: false, error: parsed.error };
    }
    c = parsed.config;
  }

  const resSec = resolutionToSeconds(c.resolution);
  let candles: OhlcvCandle[];
  try {
    candles = await fetchDeltaExchangeCandles({
      baseUrl: c.baseUrl,
      symbol: c.symbol,
      resolution: c.resolution,
      lookbackSec: c.lookbackSec,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "ta_rsi_scalper_candles_failed", { error: msg });
    return { ok: false, error: msg };
  }

  const closed = filterClosedCandles(candles, resSec);
  if (closed.length < c.rsiPeriod + 2) {
    return {
      ok: true,
      fired: false,
      detail: `Not enough closed candles (have ${closed.length}, need ${c.rsiPeriod + 2}).`,
    };
  }

  const closes = closed.map((x) => x.close);
  const rsiSeries = RSI.calculate({ period: c.rsiPeriod, values: closes });
  if (rsiSeries.length < 2) {
    return { ok: true, fired: false, detail: "RSI series too short." };
  }

  const lastCloseIdx = closed.length - 1;
  const lastRsiIdx = lastCloseIdx - c.rsiPeriod;
  if (lastRsiIdx < 1) {
    return { ok: true, fired: false, detail: "RSI index alignment error." };
  }

  const rsiNow = rsiSeries[lastRsiIdx];
  const rsiPrev = rsiSeries[lastRsiIdx - 1];
  const bar = closed[lastCloseIdx]!;

  const crossBelow =
    rsiPrev >= c.rsiLevel &&
    rsiNow < c.rsiLevel &&
    isBearishUpperWickGreaterThanBody(bar);

  if (!crossBelow) {
    return {
      ok: true,
      fired: false,
      detail: "No short signal (cross + bearish wick rule).",
      metadata: {
        rsi_now: rsiNow,
        rsi_prev: rsiPrev,
        rsi_level: c.rsiLevel,
        candle_time: bar.time,
        bearish_wick: isBearishUpperWickGreaterThanBody(bar),
      },
    };
  }

  const correlationId = `ta_rsi_${c.strategyId}_${bar.time}`;
  const exists = await hasTradingJobForCorrelationId(correlationId);
  if (exists || wasZeroJobCorrelationRecently(correlationId)) {
    return {
      ok: true,
      fired: false,
      detail: "Signal already recorded for this candle (deduped).",
      correlationId,
    };
  }

  const dispatch = await dispatchStrategyExecutionSignal({
    strategyId: c.strategyId,
    correlationId,
    symbol: c.symbol,
    side: "sell",
    orderType: "market",
    quantity: c.quantity,
    actionType: "entry",
    metadata: {
      source: "ta_rsi_scalper",
      rsi_period: c.rsiPeriod,
      rsi: rsiNow,
      rsi_prev: rsiPrev,
      rsi_level: c.rsiLevel,
      candle_open_time: bar.time,
      resolution: c.resolution,
      /** SL/TP are not applied by the execution worker yet; reserved for risk modules. */
      dynamic_risk: { note: "sl_tp_not_wired_execution_layer" },
    },
  });

  if (!dispatch.ok) {
    tradingLog("warn", "ta_rsi_scalper_dispatch_failed", {
      error: dispatch.error,
      correlationId,
    });
    return {
      ok: false,
      error: dispatch.error,
    };
  }

  if (dispatch.jobsEnqueued === 0) {
    rememberZeroJobCorrelation(correlationId);
    tradingLog("info", "ta_rsi_scalper_no_eligible_runs", {
      strategyId: c.strategyId,
      correlationId,
      candleTime: bar.time,
    });
    return {
      ok: true,
      fired: false,
      correlationId,
      dispatch,
      detail: "Signal matched but no eligible runs (0 jobs).",
      metadata: {
        rsi_now: rsiNow,
        rsi_prev: rsiPrev,
        candle_time: bar.time,
      },
    };
  }

  tradingLog("info", "ta_rsi_scalper_dispatched", {
    strategyId: c.strategyId,
    correlationId,
    jobsEnqueued: dispatch.jobsEnqueued,
    candleTime: bar.time,
  });

  return {
    ok: true,
    fired: true,
    correlationId,
    dispatch,
    detail: `Enqueued ${dispatch.jobsEnqueued} job(s).`,
    metadata: {
      rsi_now: rsiNow,
      rsi_prev: rsiPrev,
      candle_time: bar.time,
    },
  };
}
