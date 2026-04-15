/**
 * Trend Arbitrage Scalping — stateful worker (multi-account via execution signals).
 *
 * When `TA_TREND_ARB_RUN_ID` + `TA_TREND_PRIMARY_EXCHANGE_ID` are set, each tick polls Delta 1
 * position for SL/TP/soft-BE, Delta 2 grid hedges (1% steps, DB-backed), and flattens D2 when D1 is flat.
 */

import { hasTradingJobForCorrelationId } from "../execution-queue";
import { tradingLog } from "../trading-log";
import {
  fetchDeltaExchangeCandles,
  filterClosedCandles,
  resolutionToSeconds,
  type OhlcvCandle,
} from "./rsi-scalper";
import { calculateHalfTrend } from "./indicators/halftrend";
import {
  TREND_ARB_D1_SL_PCT,
  TREND_ARB_D1_TP_PCT,
  TREND_ARB_D1_TRAIL_BE_AT_PCT,
  TREND_ARB_D2_TP_PCT,
  TREND_ARB_HEDGE_STEP_PCT,
  TREND_ARB_PRIMARY_QTY,
  TREND_ARB_SECONDARY_CLIP_QTY,
} from "./trend-arb-constants";
import {
  dispatchTrendArbPrimaryEntry,
  trendArbPrimaryCorrelationId,
  type TrendArbSide,
} from "./trend-arb-dispatch";
import { pollTrendArbRiskAndHedges } from "./trend-arb-poll";
import { loadTrendArbExecutionScope, type TrendArbExecutionScope } from "./trend-arb-scope";
import type { TrendArbitrageEnv } from "./trend-arb-types";

export {
  TREND_ARB_D1_SL_PCT,
  TREND_ARB_D1_TP_PCT,
  TREND_ARB_D1_TRAIL_BE_AT_PCT,
  TREND_ARB_D2_TP_PCT,
  TREND_ARB_HEDGE_STEP_PCT,
  TREND_ARB_PRIMARY_QTY,
  TREND_ARB_SECONDARY_CLIP_QTY,
} from "./trend-arb-constants";
export {
  dispatchTrendArbClosePrimary,
  dispatchTrendArbFlattenSecondary,
  dispatchTrendArbPrimaryEntry,
  dispatchTrendArbSecondaryHedgeClip,
  trendArbPrimaryCorrelationId,
  type TrendArbSide,
} from "./trend-arb-dispatch";
export type { TrendArbExecutionScope } from "./trend-arb-scope";

/** In-memory state (legacy); hedge steps persist in `trend_arb_hedge_state`. */
export type TrendArbRunState = {
  runId: string;
  d1: {
    open: boolean;
    side: TrendArbSide | null;
    entryPrice: number | null;
    maxFavorableExcursion: number;
    hedgeStepsFilled: number;
  };
  d2: { openClipCount: number };
};

const runStateMemory = new Map<string, TrendArbRunState>();

export function getTrendArbRunState(runId: string): TrendArbRunState | undefined {
  return runStateMemory.get(runId);
}

export function seedTrendArbRunState(runId: string): TrendArbRunState {
  const s: TrendArbRunState = {
    runId,
    d1: {
      open: false,
      side: null,
      entryPrice: null,
      maxFavorableExcursion: 0,
      hedgeStepsFilled: 0,
    },
    d2: { openClipCount: 0 },
  };
  runStateMemory.set(runId, s);
  return s;
}

export type { TrendArbitrageEnv } from "./trend-arb-types";

export type ReadTrendArbitrageEnvResult =
  | { kind: "disabled" }
  | { kind: "invalid"; error: string }
  | { kind: "ok"; config: TrendArbitrageEnv };

export async function readTrendArbitrageEnv(): Promise<ReadTrendArbitrageEnvResult> {
  const enabled = process.env.TA_TREND_ARB_ENABLED?.trim() === "true";
  const strategyId = process.env.TA_TREND_ARB_STRATEGY_ID?.trim() ?? "";
  const symbol = process.env.TA_TREND_ARB_SYMBOL?.trim() || "BTC_USDT";
  const baseUrl =
    process.env.TA_TREND_ARB_DELTA_BASE_URL?.trim() || "https://api.delta.exchange";
  const resolution = process.env.TA_TREND_ARB_RESOLUTION?.trim() || "5m";
  const lookbackSec = Math.max(
    36_000,
    Number(process.env.TA_TREND_ARB_LOOKBACK_SEC?.trim() || "172800") || 172_800,
  );
  const amplitude = Math.max(
    2,
    Number(process.env.TA_TREND_AMPLITUDE?.trim() || "9") || 9,
  );
  const channelDeviation = Math.max(
    1,
    Number(process.env.TA_TREND_CHANNEL_DEVIATION?.trim() || "2") || 2,
  );

  if (!enabled) return { kind: "disabled" };
  if (!strategyId) {
    return { kind: "invalid", error: "TA_TREND_ARB_STRATEGY_ID is required." };
  }

  const runId = process.env.TA_TREND_ARB_RUN_ID?.trim() ?? "";
  const primaryEx = process.env.TA_TREND_PRIMARY_EXCHANGE_ID?.trim() ?? "";
  const secondaryEx = process.env.TA_TREND_SECONDARY_EXCHANGE_ID?.trim() || null;

  let executionScope: TrendArbExecutionScope | undefined;
  if (runId || primaryEx || secondaryEx) {
    if (!runId || !primaryEx) {
      return {
        kind: "invalid",
        error:
          "TA_TREND_ARB_RUN_ID and TA_TREND_PRIMARY_EXCHANGE_ID are required together for position polling.",
      };
    }
    const loaded = await loadTrendArbExecutionScope(
      runId,
      strategyId,
      primaryEx,
      secondaryEx,
    );
    if (!loaded.ok) {
      return { kind: "invalid", error: `execution_scope: ${loaded.error}` };
    }
    executionScope = loaded.scope;
  }

  return {
    kind: "ok",
    config: {
      enabled: true,
      strategyId,
      symbol,
      baseUrl,
      resolution,
      lookbackSec,
      amplitude,
      channelDeviation,
      executionScope,
    },
  };
}

export type TrendArbTickResult =
  | {
      ok: true;
      fired: boolean;
      detail: string;
      halfTrend?: { buySignal: boolean; sellSignal: boolean; trend: 0 | 1 };
      correlationId?: string;
    }
  | { ok: false; error: string };

/**
 * Single poll: candles → HalfTrend → optional venue poll (D1/D2) → HalfTrend primary entry when flat.
 */
export async function runTrendArbitrageOnce(
  env?: TrendArbitrageEnv,
): Promise<TrendArbTickResult> {
  let c: TrendArbitrageEnv;
  if (env) {
    c = env;
  } else {
    const parsed = await readTrendArbitrageEnv();
    if (parsed.kind === "disabled") {
      return { ok: true, fired: false, detail: "TA_TREND_ARB_ENABLED is not true." };
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
    tradingLog("warn", "ta_trend_arb_candles_failed", { error: msg });
    return { ok: false, error: msg };
  }

  const closed = filterClosedCandles(candles, resSec);
  const minBars = Math.max(101, c.amplitude + 2);
  if (closed.length < minBars) {
    return {
      ok: true,
      fired: false,
      detail: `Not enough closed candles (${closed.length}, need ${minBars}).`,
    };
  }

  const half = calculateHalfTrend(closed, c.amplitude, c.channelDeviation);
  const bar = closed[closed.length - 1]!;

  let primaryFlat = !c.executionScope;
  let pollDetail = "";
  if (c.executionScope) {
    try {
      const poll = await pollTrendArbRiskAndHedges({
        env: c,
        scope: c.executionScope,
        barTime: bar.time,
        barClose: bar.close,
      });
      primaryFlat = poll.primaryFlat;
      pollDetail = poll.detail;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("warn", "ta_trend_arb_poll_outer", { error: msg });
      primaryFlat = true;
      pollDetail = `poll_outer:${msg}`;
    }
  }

  const side: TrendArbSide | null = half.buySignal
    ? "long"
    : half.sellSignal
      ? "short"
      : null;

  if (side == null) {
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "HalfTrend: no crossover on latest bar."]
        .filter(Boolean)
        .join(" "),
      halfTrend: {
        buySignal: half.buySignal,
        sellSignal: half.sellSignal,
        trend: half.trend,
      },
    };
  }

  if (c.executionScope && !primaryFlat) {
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "Skip HalfTrend entry: primary not flat."].join(" "),
      halfTrend: {
        buySignal: half.buySignal,
        sellSignal: half.sellSignal,
        trend: half.trend,
      },
    };
  }

  const correlationId = trendArbPrimaryCorrelationId(c.strategyId, bar.time, side);
  const exists = await hasTradingJobForCorrelationId(correlationId);
  if (exists) {
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "Primary entry already queued for this candle."]
        .join(" ")
        .trim(),
      halfTrend: {
        buySignal: half.buySignal,
        sellSignal: half.sellSignal,
        trend: half.trend,
      },
      correlationId,
    };
  }

  const dispatch = await dispatchTrendArbPrimaryEntry({
    strategyId: c.strategyId,
    symbol: c.symbol,
    side,
    candleTime: bar.time,
    markPrice: bar.close,
    ...(c.executionScope
      ? {
          targetUserIds: [c.executionScope.userId],
          targetRunIds: [c.executionScope.runId],
        }
      : {}),
  });

  if (!dispatch.ok) {
    return { ok: false, error: dispatch.error };
  }

  if (dispatch.jobsEnqueued === 0) {
    tradingLog("info", "ta_trend_arb_no_eligible_runs", {
      strategyId: c.strategyId,
      correlationId,
    });
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "No eligible runs for primary entry."].join(" ").trim(),
      halfTrend: {
        buySignal: half.buySignal,
        sellSignal: half.sellSignal,
        trend: half.trend,
      },
      correlationId,
    };
  }

  tradingLog("info", "ta_trend_arb_dispatched_primary", {
    strategyId: c.strategyId,
    jobs: dispatch.jobsEnqueued,
    correlationId,
    side,
  });

  return {
    ok: true,
    fired: true,
    detail: [pollDetail, `Enqueued ${dispatch.jobsEnqueued} primary job(s).`]
      .filter(Boolean)
      .join(" "),
    halfTrend: {
      buySignal: half.buySignal,
      sellSignal: half.sellSignal,
      trend: half.trend,
    },
    correlationId,
  };
}

export function planSecondaryHedgeSteps(_state: TrendArbRunState, _markPrice: number): number[] {
  return [];
}

export function startTrendArbWorkerLoop(): NodeJS.Timeout {
  const INTERVAL_MS = Math.max(
    10_000,
    Number(process.env.TA_TREND_ARB_INTERVAL_MS?.trim() || "60000") || 60_000,
  );
  tradingLog("info", "ta_trend_arb_worker_started", { intervalMs: INTERVAL_MS });
  void runTrendArbitrageOnce().catch((e) => {
    console.error("[trend-arb] initial tick:", e);
  });
  return setInterval(() => {
    void runTrendArbitrageOnce().catch((e) => {
      console.error("[trend-arb] tick:", e);
    });
  }, INTERVAL_MS);
}
