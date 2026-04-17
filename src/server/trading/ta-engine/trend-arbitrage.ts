/**
 * Trend Arbitrage Scalping — stateful worker (multi-account via execution signals).
 *
 * When `TA_TREND_ARB_RUN_ID` + `TA_TREND_PRIMARY_EXCHANGE_ID` are set, each tick polls Delta 1
 * position for SL/TP/soft-BE, Delta 2 grid hedges (configurable step %, DB-backed),
 * and flattens D2 when D1 is flat.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { trendArbStrategyConfigSchema } from "@/lib/trend-arb-strategy-config";
import { db } from "@/server/db";
import { strategies } from "@/server/db/schema";
import {
  getLatestTradingJobByCorrelationId,
  hasTradingJobForCorrelationId,
} from "../execution-queue";
import { tradingLog } from "../trading-log";
import {
  computeTrendArbLookbackSeconds,
  filterClosedCandles,
  resolutionToSeconds,
  TREND_ARB_TARGET_CLOSED_BARS,
  type OhlcvCandle,
} from "./rsi-scalper";
import { calculateHalfTrend } from "./indicators/halftrend";
import {
  TREND_ARB_PRIMARY_QTY,
  TREND_ARB_SECONDARY_CLIP_QTY,
} from "./trend-arb-constants";
import {
  dispatchTrendArbPrimaryEntry,
  dispatchTrendArbSecondaryHedgeClip,
  trendArbPrimaryCorrelationId,
  trendArbSecondaryCorrelationId,
  type TrendArbSide,
} from "./trend-arb-dispatch";
import { pollTrendArbRiskAndHedges, pollTrendArbVirtualRiskAndHedges } from "./trend-arb-poll";
import {
  ensureTrendArbLiveFeed,
  getTrendArbLiveSnapshot,
  subscribeTrendArbLiveTicks,
} from "./trend-arb-live-feed";
import { loadTrendArbExecutionScope, type TrendArbExecutionScope } from "./trend-arb-scope";
import type { TrendArbitrageEnv, TrendArbRuntimeSettings } from "./trend-arb-types";
import { virtualBotOrders, virtualStrategyRuns } from "@/server/db/schema";

function fmtHt(n: number): string {
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(2);
}

function fmtCloseVsHt(close: number, ht: number): string {
  if (!Number.isFinite(close) || !Number.isFinite(ht)) {
    return `Close=${fmtHt(close)} HT=${fmtHt(ht)}`;
  }
  const d = close - ht;
  const pct = ht !== 0 ? (d / ht) * 100 : NaN;
  const pctStr = Number.isFinite(pct) ? `${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%` : "—";
  return `Close=${fmtHt(close)} vs HT=${fmtHt(ht)} (Δ=${fmtHt(d)}, ${pctStr} of HT line)`;
}

function formatUnixToUtcAndIst(tsSec: number): { utc: string; ist: string } {
  const ms = tsSec * 1000;
  const utc = new Date(ms).toISOString();
  const ist = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ms);
  return { utc, ist };
}

function computeD2StepQuantityFromD1Qty(params: {
  d1Qty: string | number;
  stepQtyPct: number;
  fallbackQty: string;
}): string {
  const d1 = typeof params.d1Qty === "number" ? params.d1Qty : Number(params.d1Qty);
  const pct = Number(params.stepQtyPct);
  if (!(Number.isFinite(d1) && d1 > 0) || !(Number.isFinite(pct) && pct > 0)) {
    return params.fallbackQty;
  }
  const qty = d1 * (pct / 100);
  if (!(Number.isFinite(qty) && qty > 0)) return params.fallbackQty;
  return qty.toFixed(6);
}

async function detectVirtualActiveForRun(runId: string): Promise<number | null> {
  if (!db) return null;
  const [run] = await db
    .select({ openNetQty: virtualStrategyRuns.openNetQty })
    .from(virtualStrategyRuns)
    .where(eq(virtualStrategyRuns.id, runId))
    .limit(1);
  if (!run) return null;
  const openNet = Number(run.openNetQty ?? "0");
  if (Number.isFinite(openNet) && Math.abs(openNet) > 1e-8) return openNet;
  const [net] = await db
    .select({
      q: sql<number>`COALESCE(SUM(
        CASE
          WHEN ${virtualBotOrders.side} = 'buy' THEN cast(${virtualBotOrders.quantity} as numeric)
          WHEN ${virtualBotOrders.side} = 'sell' THEN -cast(${virtualBotOrders.quantity} as numeric)
          ELSE 0
        END
      ), 0)::float8`,
    })
    .from(virtualBotOrders)
    .where(eq(virtualBotOrders.virtualRunId, runId));
  const q = Number(net?.q ?? 0);
  return Number.isFinite(q) ? q : 0;
}

function halfTrendSignalLabel(h: {
  buySignal: boolean;
  sellSignal: boolean;
}): "LONG" | "SHORT" | "WAIT" {
  if (h.buySignal) return "LONG";
  if (h.sellSignal) return "SHORT";
  return "WAIT";
}

function sideFromCloseVsHt(close: number, ht: number): -1 | 0 | 1 {
  if (!Number.isFinite(close) || !Number.isFinite(ht)) return 0;
  const d = close - ht;
  if (Math.abs(d) <= 1e-9) return 0;
  return d > 0 ? 1 : -1;
}

export {
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

const DEFAULT_TREND_ARB_RUNTIME: TrendArbRuntimeSettings = {
  symbol: "BTC_USDT",
  d1EntryQty: TREND_ARB_PRIMARY_QTY,
  d2StepQty: TREND_ARB_SECONDARY_CLIP_QTY,
  d1EntryQtyPct: 100,
  d2StepQtyPct: 10,
  d2StepMovePct: 1,
  d1TargetProfitPct: 10,
  d2TargetProfitPct: 1,
  d1StopLossPct: 3,
  d2StopLossPct: 3,
  indicatorSettings: {
    amplitude: 9,
    channelDeviation: 2,
    timeframe: "4h",
  },
};

export async function resolveTrendArbRuntimeSettings(
  strategyId: string,
): Promise<TrendArbRuntimeSettings> {
  if (!db) return DEFAULT_TREND_ARB_RUNTIME;
  const [row] = await db
    .select({
      settingsJson: strategies.settingsJson,
    })
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), isNull(strategies.deletedAt)))
    .limit(1);

  const parsed = trendArbStrategyConfigSchema.safeParse(row?.settingsJson ?? null);
  if (!parsed.success) return DEFAULT_TREND_ARB_RUNTIME;
  const cfg = parsed.data;

  const indicatorAmplitude =
    cfg.indicatorSettings.amplitude != null
      ? Math.max(2, Math.round(cfg.indicatorSettings.amplitude))
      : DEFAULT_TREND_ARB_RUNTIME.indicatorSettings.amplitude;
  const indicatorChannelDeviation =
    cfg.indicatorSettings.channelDeviation != null
      ? Math.max(1, Math.round(cfg.indicatorSettings.channelDeviation))
      : DEFAULT_TREND_ARB_RUNTIME.indicatorSettings.channelDeviation;
  const indicatorTimeframe =
    cfg.indicatorSettings.timeframe ??
    DEFAULT_TREND_ARB_RUNTIME.indicatorSettings.timeframe;

  return {
    symbol: cfg.symbol,
    d1EntryQty: TREND_ARB_PRIMARY_QTY,
    d2StepQty: TREND_ARB_SECONDARY_CLIP_QTY,
    d1EntryQtyPct: Math.max(0, cfg.delta1.entryQtyPct),
    d2StepQtyPct: Math.max(0, cfg.delta2.stepQtyPct),
    d2StepMovePct: Math.max(0.1, cfg.delta2.stepMovePct),
    d1TargetProfitPct: Math.max(0.1, cfg.delta1.targetProfitPct),
    d2TargetProfitPct: Math.max(0.1, cfg.delta2.targetProfitPct),
    d1StopLossPct: Math.max(0.1, cfg.delta1.stopLossPct),
    d2StopLossPct: Math.max(0.1, cfg.delta2.stopLossPct),
    indicatorSettings: {
      amplitude: indicatorAmplitude,
      channelDeviation: indicatorChannelDeviation,
      timeframe: indicatorTimeframe,
    },
  };
}

export async function readTrendArbitrageEnv(): Promise<ReadTrendArbitrageEnvResult> {
  const enabled = process.env.TA_TREND_ARB_ENABLED?.trim() === "true";
  const strategyId = process.env.TA_TREND_ARB_STRATEGY_ID?.trim() ?? "";
  const baseUrl =
    process.env.TA_TREND_ARB_DELTA_BASE_URL?.trim() || "https://api.india.delta.exchange";
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
  const runtime = await resolveTrendArbRuntimeSettings(strategyId);
  const symbol = runtime.symbol || process.env.TA_TREND_ARB_SYMBOL?.trim() || "BTCUSD";

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
      amplitude: runtime.indicatorSettings.amplitude || amplitude,
      channelDeviation: runtime.indicatorSettings.channelDeviation || channelDeviation,
      runtime,
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

  // Graceful settings updates: always refresh runtime sizing/risk params per tick.
  // This ensures D2 step sizing/targets use the latest strategy settings mid-trade.
  const freshRuntime = await resolveTrendArbRuntimeSettings(c.strategyId);
  c = { ...c, runtime: freshRuntime, symbol: freshRuntime.symbol || c.symbol };

  const indicatorResolution = c.runtime.indicatorSettings.timeframe || "4h";
  const resSec = resolutionToSeconds(indicatorResolution);
  const minHistorySec = computeTrendArbLookbackSeconds(resSec, TREND_ARB_TARGET_CLOSED_BARS);
  const lookbackSec = Math.max(c.lookbackSec, minHistorySec);
  let candles: OhlcvCandle[];
  let livePrice: number | null = null;
  try {
    await ensureTrendArbLiveFeed({
      baseUrl: c.baseUrl,
      symbol: c.symbol,
      resolution: indicatorResolution,
      lookbackSec,
    });
    const snapshot = getTrendArbLiveSnapshot({
      symbol: c.symbol,
      resolution: indicatorResolution,
    });
    if (snapshot && snapshot.candles.length > 0) {
      candles = snapshot.candles;
      livePrice = snapshot.lastPrice;
    } else {
      console.log("[WAITING] WebSocket feed initializing...");
      return { ok: true, fired: false, detail: "Waiting for websocket feed snapshot." };
    }
    console.log(
      `[SCANNING] WebSocket snapshot ready for ${c.symbol} @ ${indicatorResolution} with ${candles.length} bars in memory`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "ta_trend_arb_candles_failed", { error: msg });
    return { ok: false, error: msg };
  }

  const closed = filterClosedCandles(candles, resSec);
  const minBars = Math.max(TREND_ARB_TARGET_CLOSED_BARS, 101, c.amplitude + 2);
  if (closed.length < minBars) {
    console.log(
      `[SCANNING] ${c.symbol}: only ${closed.length} closed bars @ ${indicatorResolution} (need ${minBars}) — skipping indicator`,
    );
    return {
      ok: true,
      fired: false,
      detail: `Not enough closed candles (${closed.length}, need ${minBars}).`,
    };
  }

  const half = calculateHalfTrend(candles, c.amplitude, c.channelDeviation, {
    treatLastCandleAsForming: true,
  });
  const prevHalf =
    candles.length > 2
      ? calculateHalfTrend(candles.slice(0, -1), c.amplitude, c.channelDeviation)
      : null;
  const bar = candles[candles.length - 1]!;
  const lastClosed = candles[candles.length - 2] ?? bar;
  const prevClosed = candles[candles.length - 3] ?? null;
  const barCloseLive = livePrice && livePrice > 0 ? livePrice : bar.close;
  const scanSignal = halfTrendSignalLabel(half);
  console.log(
    `[SCANNING] ${c.symbol}: HalfTrend is ${fmtHt(half.htValue)}, Previous ${fmtHt(half.prevHtValue)}, Price is ${fmtHt(barCloseLive)}, Signal: ${scanSignal}`,
  );

  if (Number.isFinite(barCloseLive) && Number.isFinite(half.htValue)) {
    const denom = Math.abs(half.htValue) > 1e-12 ? Math.abs(half.htValue) : Math.abs(barCloseLive);
    const distanceRatio = denom > 0 ? Math.abs(barCloseLive - half.htValue) / denom : Infinity;
    if (distanceRatio <= 0.001) {
      console.log(
        `[HT-DEBUG] Close: ${fmtHt(barCloseLive)}, HT: ${fmtHt(half.htValue)}, MaxLow: ${fmtHt(half.maxLowPrice)}, MinHigh: ${fmtHt(half.minHighPrice)}, Trend: ${half.trend}`,
      );
    }
  }
  {
    const t = formatUnixToUtcAndIst(lastClosed.time);
    console.log(
      `[HT-CLOSE-DEBUG] closed_candle utc=${t.utc} ist=${t.ist} prevTrend=${half.prevTrend} trend=${half.trend} buySignal=${half.buySignal} sellSignal=${half.sellSignal} closedClose=${fmtHt(lastClosed.close)} closedHT=${fmtHt(half.prevHtValue)} livePrice=${fmtHt(barCloseLive)}`,
    );
  }

  // Geometric close-vs-HT flip (prev closed vs current closed relative to HT lines).
  // Used for debug only — new D1+D2 entries require native HalfTrend buy/sell signals so we
  // do not re-enter immediately after a stop/exit on the same bar geometry flip.
  const prevSide =
    prevClosed && prevHalf ? sideFromCloseVsHt(prevClosed.close, prevHalf.htValue) : 0;
  const currSide = sideFromCloseVsHt(lastClosed.close, half.prevHtValue);
  const closeVsHtFlip =
    prevSide !== 0 && currSide !== 0 && prevSide !== currSide ? currSide : 0;
  if (closeVsHtFlip !== 0) {
    const t = formatUnixToUtcAndIst(lastClosed.time);
    console.log(
      `[HT-CLOSE-FLIP] closed_candle utc=${t.utc} ist=${t.ist} prevSide=${prevSide} currSide=${currSide} prevClosed=${fmtHt(prevClosed?.close ?? NaN)} prevHT=${fmtHt(prevHalf?.htValue ?? NaN)} closedClose=${fmtHt(lastClosed.close)} closedHT=${fmtHt(half.prevHtValue)}`,
    );
  }

  // Always monitor active virtual runs for this strategy in parallel with live scope logic.
  const vMon = await pollTrendArbVirtualRiskAndHedges({
    env: c,
    barTime: bar.time,
    barClose: barCloseLive,
  });

  let primaryFlat = !c.executionScope;
  let pollDetail = "";
  if (c.executionScope) {
    try {
      const poll = await pollTrendArbRiskAndHedges({
        env: c,
        scope: c.executionScope,
        barTime: bar.time,
        barClose: barCloseLive,
      });
      primaryFlat = poll.primaryFlat;
      pollDetail = [poll.detail, vMon.detail].filter(Boolean).join("|");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("warn", "ta_trend_arb_poll_outer", { error: msg });
      primaryFlat = true;
      pollDetail = [`poll_outer:${msg}`, vMon.detail].filter(Boolean).join("|");
    }
  } else {
    pollDetail = vMon.detail;
  }

  if (primaryFlat) {
    const configuredRunId = process.env.TA_TREND_ARB_RUN_ID?.trim() ?? "";
    if (configuredRunId) {
      const vNet = await detectVirtualActiveForRun(configuredRunId);
      if (vNet != null && Math.abs(vNet) > 1e-8) {
        primaryFlat = false;
        pollDetail = [pollDetail, `virtual_active_${vNet}`].filter(Boolean).join("|");
        console.log(`[STATE-SYNC] Detected active position of ${vNet}. Switching to D2 monitoring.`);
      }
    }
  }

  // Entry only on native HalfTrend crossover signals (not geometric close-vs-HT flip alone).
  const effectiveBuySignal = half.buySignal;
  const effectiveSellSignal = half.sellSignal;
  const hasCrossover = effectiveBuySignal || effectiveSellSignal;
  if (!hasCrossover) {
    const flipHint =
      closeVsHtFlip !== 0
        ? " | close-vs-HT flip ignored until HalfTrend buy/sell signal"
        : "";
    console.log(
      `[ENTRY-CHECK] ${c.symbol}: no HalfTrend crossover on latest bar — skip entry (${pollDetail || "poll ok"})${flipHint} | ${fmtCloseVsHt(barCloseLive, half.htValue)}`,
    );
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "HalfTrend: no crossover on latest bar."]
        .filter(Boolean)
        .join(" "),
      halfTrend: {
        buySignal: effectiveBuySignal,
        sellSignal: effectiveSellSignal,
        trend: half.trend,
      },
    };
  }
  const d1Side: TrendArbSide = effectiveSellSignal
    ? "short"
    : effectiveBuySignal
      ? "long"
      : half.trend === 0
        ? "long"
        : "short";
  const d2Side: TrendArbSide = d1Side === "long" ? "short" : "long";

  if (c.executionScope && !primaryFlat) {
    console.log(
      `[ENTRY-CHECK] ${c.symbol}: primary (D1) still open for run ${c.executionScope.runId} — skip new HalfTrend entry`,
    );
    return {
      ok: true,
      fired: false,
      detail: [
        pollDetail,
        "Hold D1 until TP/SL (or manual close); ignore HalfTrend opposite while primary is open.",
      ].join(" "),
      halfTrend: {
        buySignal: effectiveBuySignal,
        sellSignal: effectiveSellSignal,
        trend: half.trend,
      },
    };
  }

  const correlationId = trendArbPrimaryCorrelationId(c.strategyId, bar.time, d1Side);
  const d2InitialCorrelationId = trendArbSecondaryCorrelationId(c.strategyId, bar.time, 0);
  const [d1Exists, d2InitialExists, d1Job, d2Job] = await Promise.all([
    hasTradingJobForCorrelationId(correlationId),
    hasTradingJobForCorrelationId(d2InitialCorrelationId),
    getLatestTradingJobByCorrelationId(correlationId),
    getLatestTradingJobByCorrelationId(d2InitialCorrelationId),
  ]);
  if (d1Exists || d2InitialExists) {
    const d1State = d1Job
      ? `${d1Job.status}/a${d1Job.attempts}-${d1Job.maxAttempts}`
      : "none";
    const d2State = d2Job
      ? `${d2Job.status}/a${d2Job.attempts}-${d2Job.maxAttempts}`
      : "none";
    console.log(
      `[ENTRY-CHECK] ${c.symbol}: initial D1/D2 entry already queued for this candle (D1=${correlationId} status=${d1State}, D2=${d2InitialCorrelationId} status=${d2State})`,
    );
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "Initial D1/D2 entries already queued for this candle."]
        .join(" ")
        .trim(),
      halfTrend: {
        buySignal: effectiveBuySignal,
        sellSignal: effectiveSellSignal,
        trend: half.trend,
      },
      correlationId,
    };
  }

  console.log(
    `[ENTRY-CHECK] ${c.symbol}: evaluating simultaneous initial hedge entries @ ${fmtHt(barCloseLive)} (D1=${d1Side.toUpperCase()}, D2=${d2Side.toUpperCase()}) correlations D1=${correlationId}, D2=${d2InitialCorrelationId} | ${fmtCloseVsHt(barCloseLive, half.htValue)}`,
  );

  const dispatchScope = c.executionScope
    ? {
        targetUserIds: [c.executionScope.userId],
        targetRunIds: [c.executionScope.runId],
      }
    : {};
  const [primaryDispatch, secondaryDispatch] = await Promise.all([
    dispatchTrendArbPrimaryEntry({
      strategyId: c.strategyId,
      symbol: c.runtime.symbol || c.symbol,
      quantity: c.runtime.d1EntryQty,
      entryQtyPct: c.runtime.d1EntryQtyPct,
      stopLossPct: c.runtime.d1StopLossPct,
      targetProfitPct: c.runtime.d1TargetProfitPct,
      side: d1Side,
      candleTime: bar.time,
      markPrice: barCloseLive,
      ...dispatchScope,
    }),
    dispatchTrendArbSecondaryHedgeClip({
      strategyId: c.strategyId,
      symbol: c.runtime.symbol || c.symbol,
      candleTime: bar.time,
      stepIndex: 0,
      side: d2Side,
      forceSide: d2Side,
      markPrice: barCloseLive,
      quantity: computeD2StepQuantityFromD1Qty({
        d1Qty: c.runtime.d1EntryQty,
        stepQtyPct: c.runtime.d2StepQtyPct,
        fallbackQty: c.runtime.d2StepQty,
      }),
      stepQtyPct: c.runtime.d2StepQtyPct,
      targetProfitPct: c.runtime.d2TargetProfitPct,
      applyCapitalSplitSizing: true,
      d1ClipQtyPct: c.runtime.d1EntryQtyPct,
      d2DisplayStep: 1,
      d2StepLabel: "D2 Step 1",
      correlationIdOverride: d2InitialCorrelationId,
      ...dispatchScope,
    }),
  ]);

  if (!primaryDispatch.ok || !secondaryDispatch.ok) {
    const dispatchError =
      !primaryDispatch.ok
        ? `d1:${primaryDispatch.error}`
        : !secondaryDispatch.ok
          ? `d2:${secondaryDispatch.error}`
          : "unknown_dispatch_error";
    console.log(
      `[ENTRY-CHECK] ${c.symbol}: initial hedge dispatch failed — ${dispatchError} | ${fmtCloseVsHt(barCloseLive, half.htValue)}`,
    );
    return { ok: false, error: dispatchError };
  }

  const totalJobs = primaryDispatch.jobsEnqueued + secondaryDispatch.jobsEnqueued;
  if (primaryDispatch.jobsEnqueued === 0 && secondaryDispatch.jobsEnqueued === 0) {
    console.log(
      `[ENTRY-CHECK] ${c.symbol}: dispatch returned 0 jobs — no eligible runs for initial D1/D2 entries`,
    );
    tradingLog("info", "ta_trend_arb_no_eligible_runs", {
      strategyId: c.strategyId,
      correlationId,
    });
    return {
      ok: true,
      fired: false,
      detail: [pollDetail, "No eligible runs for initial D1/D2 entries."].join(" ").trim(),
      halfTrend: {
        buySignal: effectiveBuySignal,
        sellSignal: effectiveSellSignal,
        trend: half.trend,
      },
      correlationId,
    };
  }

  tradingLog("info", "ta_trend_arb_dispatched_primary", {
    strategyId: c.strategyId,
    jobs: totalJobs,
    d1Jobs: primaryDispatch.jobsEnqueued,
    d2Jobs: secondaryDispatch.jobsEnqueued,
    correlationId,
    side: d1Side,
  });
  console.log(
    `[ENTRY-CHECK] ${c.symbol}: enqueued D1=${primaryDispatch.jobsEnqueued} ${d1Side.toUpperCase()} and D2(initial step 0)=${secondaryDispatch.jobsEnqueued} ${d2Side.toUpperCase()} job(s)`,
  );

  return {
    ok: true,
    fired: true,
    detail: [
      pollDetail,
      `Enqueued initial hedge jobs: D1=${primaryDispatch.jobsEnqueued}, D2(step 0)=${secondaryDispatch.jobsEnqueued}.`,
    ]
      .filter(Boolean)
      .join(" "),
    halfTrend: {
      buySignal: effectiveBuySignal,
      sellSignal: effectiveSellSignal,
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
  let running = false;
  const runOnceSafe = () => {
    if (running) return;
    running = true;
    void runTrendArbitrageOnce()
      .catch((e) => {
        console.error("[trend-arb] tick:", e);
      })
      .finally(() => {
        running = false;
      });
  };

  void (async () => {
    const envRes = await readTrendArbitrageEnv();
    if (envRes.kind === "ok") {
      const resolution = envRes.config.runtime.indicatorSettings.timeframe || "1m";
      await ensureTrendArbLiveFeed({
        symbol: envRes.config.symbol,
        resolution,
        baseUrl: envRes.config.baseUrl,
        lookbackSec: Math.max(
          envRes.config.lookbackSec,
          computeTrendArbLookbackSeconds(
            resolutionToSeconds(resolution),
            TREND_ARB_TARGET_CLOSED_BARS,
          ),
        ),
      });
      subscribeTrendArbLiveTicks({
        symbol: envRes.config.symbol,
        resolution,
        onTick: runOnceSafe,
      });
    }
    runOnceSafe();
  })();

  return setInterval(runOnceSafe, INTERVAL_MS);
}
