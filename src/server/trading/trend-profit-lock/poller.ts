import { and, eq, isNull, sql } from "drizzle-orm";

import { resolveTrendProfitLockConfigForUi } from "@/lib/trend-profit-lock-form";
import {
  parseUserStrategyRunSettingsJson,
  userStrategyRunSettingsJsonSchema,
} from "@/lib/user-strategy-run-settings-json";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";
import {
  fetchDeltaIndiaProductContractValue,
  fetchDeltaIndiaProductMinOrderContracts,
} from "@/server/exchange/delta-product-resolver";
import { db } from "@/server/db";
import {
  botOrders,
  botPositions,
  exchangeConnections,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";
import { generateInternalClientOrderId } from "@/server/trading/ids";
import { recordBotExecutionLog } from "@/server/trading/bot-order-service";
import {
  resolveFinalAllocatedCapitalUsd,
  resolveRawLeverageStringForExecution,
} from "@/server/trading/execution-preferences";
import { calculateHalfTrendSignal, type HalfTrendCandle } from "@/server/trading/indicators/halftrend";
import { resolveExchangeTradingAdapter } from "@/server/trading/adapters/resolve-exchange-adapter";
import { dispatchStrategyExecutionSignal } from "@/server/trading/strategy-signal-dispatcher";
import type { StrategySignalIntakeResponse } from "@/server/trading/signals/types";
import {
  ensureHedgeScalpingLiveFeed,
  getHedgeScalpingLiveSnapshot,
} from "@/server/trading/ta-engine/hedge-scalping-live-feed";
import {
  computeChartLookbackSeconds,
  resolutionToSeconds,
  TA_CHART_TARGET_CLOSED_BARS,
  type OhlcvCandle,
} from "@/server/trading/ta-engine/rsi-scalper";
import { tradingLog } from "@/server/trading/trading-log";
import { cancelAllTplLingeringOrders } from "@/server/trading/trend-profit-lock/cancel-tpl-lingering-orders";
import {
  inferD1TplExitReasonFromMark,
  logTplTradeExited,
  persistTplTradeExitUiHint,
} from "@/server/trading/tpl-trade-exit";

const LOG = "[TPL-POLLER]";
const DELTA_BASE_URL = process.env.HS_WORKER_DELTA_BASE_URL?.trim() || "https://api.india.delta.exchange";

/** Throttle `tpl_halftrend_state_sync` to at most once per wall minute unless a new closed bucket appears. */
const TPL_HALFTREND_SYNC_MIN_INTERVAL_MS = 60_000;
const tplHalftrendSyncState = new Map<
  string,
  { lastLoggedClosedTime: number | null; lastLogWallMs: number }
>();

function tplHalftrendSyncKey(runId: string, symbol: string, resolution: string): string {
  return `${runId}::${symbol.trim().toUpperCase()}::${resolution.trim().toLowerCase()}`;
}

function halfTrendTrendToUpDown(trend: number): "UP" | "DOWN" {
  return trend === 0 ? "UP" : "DOWN";
}

/** Normalize OHLCV → HalfTrend series (sorted ascending by bar open time, seconds). */
function mapSnapshotCandlesToHalfTrendSeries(raw: OhlcvCandle[]): HalfTrendCandle[] {
  const out: HalfTrendCandle[] = [];
  for (const c of raw) {
    let t = Number(c.time);
    if (t > 1e15) t = Math.floor(t / 1_000_000);
    else if (t > 1e12) t = Math.floor(t / 1000);
    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    const volume = Number(c.volume);
    if (![t, open, high, low, close].every((x) => Number.isFinite(x))) continue;
    out.push({
      time: t,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

type TplRuntimeState = {
  /** Latest closed bar `time` for which we already acted on a HalfTrend flip (avoids duplicate D1 on the same bar). */
  lastFlipCandleTime?: number;
  lastCompletedD1FlipDirection?: "LONG" | "SHORT";
  /** Set by manual close API to block immediate same-trend re-entry until a truly new HT flip appears. */
  isManualClosed?: boolean;
  mockNextFlipDirection?: "UP" | "DOWN";
  d1BaseQtyInt?: number;
  d1?: {
    side: "LONG" | "SHORT";
    entryPrice: number;
    targetPrice: number;
    stoplossPrice: number;
    breakevenTriggerPct: number;
    breakevenQueuedAt?: string;
    breakevenExecutedAt?: string;
    breakevenOrderCorrelationId?: string;
    stopLossOrderExternalId?: string;
    stopLossOrderClientId?: string;
    stopLossPlacedAt?: string;
    takeProfitOrderExternalId?: string;
    takeProfitOrderClientId?: string;
    takeProfitPlacedAt?: string;
  };
  d2TriggeredSteps?: number[];
  /** Last known entry mark per D2 step (retained after close for link targets). */
  d2StepLastEntries?: Record<string, number>;
  d2StepsState?: Record<
    string,
    {
      step: number;
      triggerPrice: number;
      entryMarkPrice: number;
      side: "LONG" | "SHORT";
      qty: number;
      targetPrice: number;
      stoplossPrice: number;
      executedAt: string;
      correlationId: string;
      status: "drafting" | "submitting" | "open" | "closed";
      closeReason?: "target" | "stoploss" | "unknown";
      closedAt?: string;
      takeProfitOrderExternalId?: string;
      takeProfitOrderClientId?: string;
      takeProfitPlacedAt?: string;
      stopLossOrderExternalId?: string;
      stopLossOrderClientId?: string;
      stopLossPlacedAt?: string;
      /** SL loop guard: block same-step immediate reload after SL exits. */
      slHitLock?: boolean;
      /** Price level that must be re-touched after an away move to re-arm this step. */
      rearmTriggerPrice?: number;
      /** True once price moved significantly away from trigger after an SL lock. */
      rearmSeenAway?: boolean;
    }
  >;
};

function n(v: unknown): number {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : NaN;
}

function fmtQty(v: number): string {
  return Math.floor(v).toString();
}

/**
 * Delta `contract_value` is usually **base asset per contract** (e.g. 0.001 BTC); then USD/lot ≈ mark × size.
 * If the API already returns USD per lot (large number), use it as-is.
 */
function normalizeUsdContractValue(raw: number | null, mark: number): number {
  if (raw != null && Number.isFinite(raw) && raw > 0) {
    if (raw >= 0.5) return raw;
    if (mark > 0) {
      const converted = raw * mark;
      if (Number.isFinite(converted) && converted > 0) return converted;
    }
  }
  return 1;
}

function sideFromFlip(flipTo: 0 | 1): "LONG" | "SHORT" {
  return flipTo === 0 ? "LONG" : "SHORT";
}

function oppositeSide(side: "LONG" | "SHORT"): "LONG" | "SHORT" {
  return side === "LONG" ? "SHORT" : "LONG";
}

function targetPrice(entry: number, side: "LONG" | "SHORT", targetPct: number): number {
  const t = targetPct / 100;
  return side === "LONG" ? entry * (1 + t) : entry * (1 - t);
}

function stoplossPrice(entry: number, side: "LONG" | "SHORT", stopPct: number): number {
  const s = stopPct / 100;
  return side === "LONG" ? entry * (1 - s) : entry * (1 + s);
}

function d2StoplossFromD1Distance(params: {
  d2EntryPrice: number;
  d2Side: "LONG" | "SHORT";
  d1TargetDistance: number;
  stepStoplossPct: number;
}): number {
  const distance = Math.max(0, params.d1TargetDistance);
  // Backward-compatible normalization:
  // - expected modern input: 0..100 (%)
  // - legacy decimal input seen in some runs: 0..1 (fraction)
  const rawPct = Math.max(0, params.stepStoplossPct);
  const pct = rawPct > 0 && rawPct < 1 ? rawPct * 100 : rawPct;
  const stepFrac = pct / 100;
  const slOffset = distance * stepFrac;
  if (params.d2Side === "LONG") return params.d2EntryPrice - slOffset;
  return params.d2EntryPrice + slOffset;
}

function favorableDistance(entry: number, mark: number, side: "LONG" | "SHORT"): number {
  if (!(entry > 0) || !(mark > 0)) return 0;
  return side === "LONG" ? mark - entry : entry - mark;
}

function favorableDistancePct(entry: number, mark: number, side: "LONG" | "SHORT"): number {
  if (!(entry > 0) || !(mark > 0)) return 0;
  if (side === "LONG") return ((mark - entry) / entry) * 100;
  return ((entry - mark) / entry) * 100;
}

function d2StepRearmAwayDistance(params: {
  entryPx: number;
  triggerPx: number;
  d1TargetDistance: number;
}): number {
  const targetFrac = Math.abs(params.d1TargetDistance) * 0.15;
  const triggerFrac = Math.abs(params.triggerPx - params.entryPx) * 0.5;
  const floor = Math.max(Math.abs(params.entryPx) * 0.0005, 10);
  return Math.max(floor, targetFrac, triggerFrac);
}

function estimateStepLiveQtyForExit(params: {
  stateQty: number;
  d2OpenQtyTracked: number;
  d2NetQtyAbs: number;
}): number {
  const stateQty = Math.max(0, Math.floor(params.stateQty));
  const trackedOpen = Math.max(0, params.d2OpenQtyTracked);
  const netAbs = Math.max(0, params.d2NetQtyAbs);
  // Approximate how much of current exchange net can belong to this step.
  const expectedOpenWithoutStep = Math.max(0, trackedOpen - stateQty);
  const stepShareOnExchange = Math.max(0, netAbs - expectedOpenWithoutStep);
  const bounded = Math.min(stateQty, stepShareOnExchange > 0 ? stepShareOnExchange : stateQty);
  return Math.max(0, Math.floor(bounded));
}

function theoreticalStepEntryPrice(params: {
  d1EntryPrice: number;
  d1Side: "LONG" | "SHORT";
  d1TargetDistance: number;
  stepTriggerPct: number;
}): number {
  const dist = Math.max(0, params.d1TargetDistance) * (Math.max(0, params.stepTriggerPct) / 100);
  return params.d1Side === "LONG" ? params.d1EntryPrice + dist : params.d1EntryPrice - dist;
}

function resolveLinkedTargetPrice(params: {
  d1EntryPrice: number;
  /** Used when `d1EntryPrice` is missing/invalid so linked steps never resolve to NaN. */
  markPrice: number;
  d1Side: "LONG" | "SHORT";
  d1TargetDistance: number;
  targetLinkType: "D1_ENTRY" | "STEP_1_ENTRY" | "STEP_2_ENTRY" | "STEP_3_ENTRY" | "STEP_4_ENTRY";
  d2ConfigSteps: {
    step: number;
    stepTriggerPct: number;
  }[];
  d2States: TplRuntimeState["d2StepsState"];
  d2StepLastEntries?: Record<string, number>;
}): { price: number; linkedStep: number | null; fallbackUsed: boolean } {
  const d1Ok = Number.isFinite(params.d1EntryPrice) && params.d1EntryPrice > 0;
  const markOk = Number.isFinite(params.markPrice) && params.markPrice > 0;
  const anchor = d1Ok ? params.d1EntryPrice : markOk ? params.markPrice : Number.NaN;
  const link = params.targetLinkType;
  if (link === "D1_ENTRY") {
    return { price: anchor, linkedStep: null, fallbackUsed: !d1Ok };
  }
  const stepNum = Number(link.replace("STEP_", "").replace("_ENTRY", ""));
  if (!Number.isFinite(stepNum) || stepNum < 1) {
    return { price: anchor, linkedStep: null, fallbackUsed: true };
  }
  const linked = params.d2States?.[String(stepNum)];
  if (linked && Number.isFinite(linked.entryMarkPrice) && linked.entryMarkPrice > 0) {
    return { price: linked.entryMarkPrice, linkedStep: stepNum, fallbackUsed: false };
  }
  const lastEntry = params.d2StepLastEntries?.[String(stepNum)];
  if (Number.isFinite(lastEntry) && Number(lastEntry) > 0) {
    return { price: Number(lastEntry), linkedStep: stepNum, fallbackUsed: false };
  }
  const linkedCfg = params.d2ConfigSteps.find((s) => s.step === stepNum);
  if (linkedCfg && d1Ok) {
    const theoretical = theoreticalStepEntryPrice({
      d1EntryPrice: params.d1EntryPrice,
      d1Side: params.d1Side,
      d1TargetDistance: params.d1TargetDistance,
      stepTriggerPct: linkedCfg.stepTriggerPct,
    });
    if (Number.isFinite(theoretical) && theoretical > 0) {
      return { price: theoretical, linkedStep: stepNum, fallbackUsed: true };
    }
  }
  return { price: anchor, linkedStep: stepNum, fallbackUsed: true };
}

function parseLinkedStepFromTargetType(
  targetLinkType: "D1_ENTRY" | "STEP_1_ENTRY" | "STEP_2_ENTRY" | "STEP_3_ENTRY" | "STEP_4_ENTRY",
): number | null {
  if (targetLinkType === "D1_ENTRY") return null;
  const stepNum = Number(targetLinkType.replace("STEP_", "").replace("_ENTRY", ""));
  return Number.isFinite(stepNum) && stepNum >= 1 ? stepNum : null;
}

async function resolveLiveMark(symbol: string, fallback: number | null): Promise<number | null> {
  try {
    const mark = await fetchDeltaIndiaTickerMarkPrice({ symbol });
    if (mark != null && Number.isFinite(mark) && mark > 0) return mark;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "tpl_resolve_live_mark_fetch_failed", {
      symbol,
      error: msg.slice(0, 300),
    });
  }
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

async function persistRuntime(
  runId: string,
  parsedRun: Record<string, unknown>,
  runtime: TplRuntimeState,
): Promise<void> {
  try {
    await db!
      .update(userStrategyRuns)
      .set({
        runSettingsJson: {
          ...parsedRun,
          trendProfitLockRuntime: runtime,
        },
        updatedAt: new Date(),
      })
      .where(eq(userStrategyRuns.id, runId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("error", "tpl_persist_runtime_failed", {
      runId,
      error: msg.slice(0, 500),
    });
  }
}

/**
 * Crash-safe persistence for protective venue order ids.
 * This updates only the specific JSON path on DB side so IDs survive
 * even if the rest of the tick fails before full runtime persist.
 */
async function updateRuntimeOrderId(
  runId: string,
  type: "d1_stop_loss_external_id",
  orderId: string,
): Promise<void> {
  const trimmed = String(orderId ?? "").trim();
  if (!trimmed) return;
  const path =
    type === "d1_stop_loss_external_id"
      ? "{trendProfitLockRuntime,d1,stopLossOrderExternalId}"
      : null;
  if (!path) return;
  try {
    await db!.execute(sql`
      UPDATE user_strategy_runs
      SET
        run_settings_json = jsonb_set(
          COALESCE(run_settings_json, '{}'::jsonb),
          ${path}::text[],
          to_jsonb(${trimmed}::text),
          true
        ),
        updated_at = NOW()
      WHERE id = ${runId}::uuid
    `);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "tpl_runtime_atomic_order_id_persist_failed", {
      runId,
      type,
      orderId: trimmed,
      error: msg.slice(0, 400),
    });
  }
}

async function tryRecordExecutionLogByCorrelation(params: {
  correlationId: string;
  runId: string;
  exchangeConnectionId: string | null | undefined;
  message: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!params.exchangeConnectionId) return;
  try {
    const [row] = await db!
      .select({ id: botOrders.id })
      .from(botOrders)
      .where(
        and(
          eq(botOrders.runId, params.runId),
          eq(botOrders.exchangeConnectionId, params.exchangeConnectionId),
          eq(botOrders.correlationId, params.correlationId),
        ),
      )
      .limit(1);
    if (!row) return;
    await recordBotExecutionLog({
      botOrderId: row.id,
      level: "info",
      message: params.message,
      rawPayload: params.payload,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "tpl_execution_log_write_failed", {
      runId: params.runId,
      correlationId: params.correlationId,
      error: msg.slice(0, 400),
    });
  }
}

async function resolveRunExchangeAdapter(exchangeConnectionId: string | null | undefined) {
  if (!exchangeConnectionId) return { ok: false as const, error: "exchange_connection_missing" };
  const [ec] = await db!
    .select({
      provider: exchangeConnections.provider,
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
    .from(exchangeConnections)
    .where(eq(exchangeConnections.id, exchangeConnectionId))
    .limit(1);
  if (!ec) return { ok: false as const, error: "exchange_connection_not_found" };
  return resolveExchangeTradingAdapter({
    provider: ec.provider,
    apiKeyCiphertext: ec.apiKeyCiphertext,
    apiSecretCiphertext: ec.apiSecretCiphertext,
  });
}

export async function processTrendProfitLockTick(): Promise<void> {
  if (!db) return;
  const activeRuns = await db
    .select({
      runId: userStrategyRuns.id,
      runSettingsJson: userStrategyRuns.runSettingsJson,
      subscriptionId: userStrategySubscriptions.id,
      userId: userStrategySubscriptions.userId,
      strategyId: strategies.id,
      strategySettingsJson: strategies.settingsJson,
      primaryExchangeConnectionId: userStrategyRuns.primaryExchangeConnectionId,
      secondaryExchangeConnectionId: userStrategyRuns.secondaryExchangeConnectionId,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
      recommendedCapitalInr: strategies.recommendedCapitalInr,
      strategyMaxLeverage: strategies.maxLeverage,
      slug: strategies.slug,
    })
    .from(userStrategyRuns)
    .innerJoin(userStrategySubscriptions, eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id))
    .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
    .where(
      and(
        eq(userStrategyRuns.status, "active"),
        eq(userStrategySubscriptions.status, "active"),
        isNull(userStrategySubscriptions.deletedAt),
        isNull(strategies.deletedAt),
      ),
    );

  for (const run of activeRuns) {
    if (!run.slug.toLowerCase().includes("trend-profit-lock-scalping")) continue;
    try {
    const parsedRun = parseUserStrategyRunSettingsJson(run.runSettingsJson);
    const cfg = resolveTrendProfitLockConfigForUi({
      strategySettingsJson: run.strategySettingsJson,
      runSettingsTrendProfitLock: parsedRun.trendProfitLock ?? null,
    });
    const runtime: TplRuntimeState =
      parsedRun.trendProfitLockRuntime && typeof parsedRun.trendProfitLockRuntime === "object"
        ? (parsedRun.trendProfitLockRuntime as TplRuntimeState)
        : {};

    const symbol = cfg.symbol.trim().toUpperCase();
    const resolution = cfg.timeframe.trim().toLowerCase();
    const resSec = resolutionToSeconds(resolution);
    const lookbackSec = computeChartLookbackSeconds(resSec, TA_CHART_TARGET_CLOSED_BARS);
    await ensureHedgeScalpingLiveFeed({ baseUrl: DELTA_BASE_URL, symbol, resolution, lookbackSec });
    const snapshot = getHedgeScalpingLiveSnapshot({ symbol, resolution });
    if (!snapshot) continue;
    const hasPendingMockFlip =
      runtime.mockNextFlipDirection === "UP" || runtime.mockNextFlipDirection === "DOWN";
    if (snapshot.candles.length < 40 && !hasPendingMockFlip) continue;

    /**
     * HalfTrend must not read the feed's tail bar: it is still updating (repaint). Match TradingView by
     * computing on all bars except the last snapshot bucket, then compare latest vs second-latest closed HT.
     */
    const seriesAll = mapSnapshotCandlesToHalfTrendSeries(snapshot.candles);
    if (seriesAll.length < 31 && !hasPendingMockFlip) continue;
    const closedCandles: HalfTrendCandle[] = seriesAll.slice(0, -1);
    if (closedCandles.length < 30 && !hasPendingMockFlip) continue;

    const amp = cfg.halftrendAmplitude;
    const htLatestClosed =
      closedCandles.length >= 1 ? calculateHalfTrendSignal(closedCandles, amp) : null;
    const htPreviousClosed =
      closedCandles.length >= 2
        ? calculateHalfTrendSignal(closedCandles.slice(0, -1), amp)
        : null;

    const latestClosedBarTime =
      closedCandles.length > 0
        ? closedCandles[closedCandles.length - 1]!.time
        : Math.floor(Date.now() / Math.max(1, resSec)) * Math.max(1, resSec);
    const halfTrendFreshFlipOnLatestClosed =
      htPreviousClosed != null &&
      htLatestClosed != null &&
      htLatestClosed.trend !== htPreviousClosed.trend;
    const htLatestClosedTrend: "UP" | "DOWN" =
      htLatestClosed != null ? halfTrendTrendToUpDown(htLatestClosed.trend) : "UP";
    let isFlip = halfTrendFreshFlipOnLatestClosed;
    let flipDirection: "UP" | "DOWN" = htLatestClosedTrend;
    let isForcedMockFlip = false;
    if (runtime.mockNextFlipDirection) {
      isFlip = true;
      flipDirection = runtime.mockNextFlipDirection;
      isForcedMockFlip = true;
      tradingLog("info", "tpl_mock_flip_triggered", {
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        direction: flipDirection,
        forceEntry: true,
      });
      runtime.mockNextFlipDirection = undefined;
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
    }
    let manualCloseEntryBlock = runtime.isManualClosed === true;
    if (manualCloseEntryBlock) {
      const newDistinctFlip =
        isFlip && (isForcedMockFlip || latestClosedBarTime !== runtime.lastFlipCandleTime);
      if (newDistinctFlip) {
        runtime.isManualClosed = undefined;
        await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
        manualCloseEntryBlock = false;
        tradingLog("info", "tpl_manual_close_guard_cleared_on_new_flip", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          latestClosedBarTime,
          flipDirection,
        });
      } else {
        tradingLog("info", "tpl_manual_close_entry_block_active", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          latestClosedBarTime,
          lastFlipCandleTime: runtime.lastFlipCandleTime ?? null,
          isFlip,
          flipDirection,
        });
      }
    }

    if (htPreviousClosed != null && htLatestClosed != null) {
      const syncKey = tplHalftrendSyncKey(run.runId, symbol, resolution);
      const prev = tplHalftrendSyncState.get(syncKey) ?? {
        lastLoggedClosedTime: null,
        lastLogWallMs: 0,
      };
      const nowMs = Date.now();
      const newClosedBucket = prev.lastLoggedClosedTime !== latestClosedBarTime;
      const minuteElapsed = nowMs - prev.lastLogWallMs >= TPL_HALFTREND_SYNC_MIN_INTERVAL_MS;
      if (newClosedBucket || minuteElapsed) {
        if (newClosedBucket) {
          tradingLog("info", "tpl_ht_calc_debug", {
            event: "tpl_ht_calc_debug",
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            resolution,
            latestClosedTime: latestClosedBarTime,
            amplitude: amp,
            atr: htLatestClosed.atr ?? null,
            highPrice: htLatestClosed.highPrice ?? null,
            lowPrice: htLatestClosed.lowPrice ?? null,
            up: htLatestClosed.up ?? null,
            down: htLatestClosed.down ?? null,
            trend: htLatestClosed.trend,
          });
        }
        tradingLog("info", "tpl_halftrend_state_sync", {
          event: "tpl_halftrend_state_sync",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          resolution,
          latestClosedTime: latestClosedBarTime,
          htLatestClosedTrend,
          htPreviousClosedTrend: halfTrendTrendToUpDown(htPreviousClosed.trend),
          halfTrendFreshFlipOnLatestClosed,
          closedBarCount: closedCandles.length,
        });
        tplHalftrendSyncState.set(syncKey, {
          lastLoggedClosedTime: latestClosedBarTime,
          lastLogWallMs: nowMs,
        });
      }
    }
    const mark = await resolveLiveMark(symbol, snapshot.lastPrice);
    if (mark == null) continue;

    const [d1Pos] = await db
      .select({ netQty: botPositions.netQuantity, avgEntry: botPositions.averageEntryPrice })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.subscriptionId, run.subscriptionId),
          eq(botPositions.strategyId, run.strategyId),
          eq(botPositions.exchangeConnectionId, run.primaryExchangeConnectionId ?? ""),
          eq(botPositions.symbol, symbol),
        ),
      )
      .limit(1);
    const [d2Pos] = await db
      .select({ netQty: botPositions.netQuantity })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.subscriptionId, run.subscriptionId),
          eq(botPositions.strategyId, run.strategyId),
          eq(botPositions.exchangeConnectionId, run.secondaryExchangeConnectionId ?? ""),
          eq(botPositions.symbol, symbol),
        ),
      )
      .limit(1);

    const netQty = n(d1Pos?.netQty);
    const hasOpenD1 = Number.isFinite(netQty) && Math.abs(netQty) > 1e-8;
    const d2Net = n(d2Pos?.netQty);
    const d2NetQtyAbs = Number.isFinite(d2Net) ? Math.abs(d2Net) : 0;

    if (
      !hasOpenD1 &&
      !runtime.d1 &&
      ((runtime.d2TriggeredSteps?.length ?? 0) > 0 ||
        (runtime.d2StepsState != null && Object.keys(runtime.d2StepsState).length > 0))
    ) {
      tradingLog("warn", "tpl_runtime_stale_d2_state_wiped", {
        event: "tpl_runtime_stale_d2_state_wiped",
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        staleTriggeredSteps: runtime.d2TriggeredSteps ?? [],
        staleD2StateKeys: Object.keys(runtime.d2StepsState ?? {}),
      });
      runtime.d2TriggeredSteps = [];
      runtime.d2StepLastEntries = {};
      runtime.d2StepsState = {};
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
    }

    let clearedStaleD1RuntimeThisTick = false;
    if (!hasOpenD1 && runtime.d1) {
      clearedStaleD1RuntimeThisTick = true;
      const runtimeSlice: Record<string, unknown> = {
        d1: runtime.d1,
        d2StepsState: runtime.d2StepsState ?? {},
      };
      const primaryAd = run.primaryExchangeConnectionId
        ? await resolveRunExchangeAdapter(run.primaryExchangeConnectionId)
        : { ok: false as const, error: "missing_primary" };
      const secondaryAd = run.secondaryExchangeConnectionId
        ? await resolveRunExchangeAdapter(run.secondaryExchangeConnectionId)
        : { ok: false as const, error: "missing_secondary" };
      await cancelAllTplLingeringOrders({
        runtime: runtimeSlice,
        primaryAdapter: primaryAd.ok ? primaryAd.adapter : null,
        secondaryAdapter: secondaryAd.ok ? secondaryAd.adapter : null,
        log: {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          source: "tpl_d1_flat_runtime_wipeout",
        },
      });
      for (const venue of [
        { name: "primary" as const, adapter: primaryAd.ok ? primaryAd.adapter : null },
        { name: "secondary" as const, adapter: secondaryAd.ok ? secondaryAd.adapter : null },
      ]) {
        if (!venue.adapter?.cancelAllConditionalOrdersForSymbol) continue;
        const nuke = await venue.adapter.cancelAllConditionalOrdersForSymbol(symbol);
        tradingLog(nuke.ok ? "warn" : "error", "tpl_d1_nuke_symbol_conditionals", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          venue: venue.name,
          source: "tpl_d1_flat_runtime_wipeout",
          ok: nuke.ok,
          cancelledCount: nuke.ok ? nuke.cancelledCount : 0,
          attemptedCount: nuke.ok ? nuke.attemptedCount : 0,
          error: nuke.ok ? null : nuke.error,
          raw: nuke.raw ?? null,
        });
      }
      let flattenDispatchOk = false;
      if (d2NetQtyAbs > 1e-8 && run.secondaryExchangeConnectionId) {
        const flattenCorrelationId = `tpl_d2_flatten_${run.runId}_${Date.now()}`;
        const flattenSide = d2Net > 0 ? "sell" : "buy";
        const flattenQty = Math.max(1, Math.floor(d2NetQtyAbs));
        let flattenDispatch: StrategySignalIntakeResponse;
        try {
          flattenDispatch = await dispatchStrategyExecutionSignal({
            strategyId: run.strategyId,
            correlationId: flattenCorrelationId,
            symbol,
            side: flattenSide,
            orderType: "market",
            quantity: fmtQty(flattenQty),
            actionType: "exit",
            executionMode: "live_only",
            targetRunIds: [run.runId],
            exchangeVenue: "secondary",
            metadata: {
              source: "trend_profit_lock_poller",
              leg: "d2_flatten_all",
              reason: "d1_anchor_closed",
              manual_emergency_close: true,
              force_signal_quantity: true,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          flattenDispatch = { ok: false, error: `dispatch_exception: ${msg.slice(0, 400)}` };
        }
        tradingLog(flattenDispatch.ok ? "warn" : "error", "tpl_d1_closed_wipeout_d2_dispatched", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          flattenQty,
          correlationId: flattenCorrelationId,
          ok: flattenDispatch.ok,
          liveJobsEnqueued: flattenDispatch.ok ? flattenDispatch.liveJobsEnqueued : 0,
          error: flattenDispatch.ok ? null : flattenDispatch.error,
        });
        if (flattenDispatch.ok) {
          flattenDispatchOk = true;
          logTplTradeExited({
            reason: "wipeout_triggered",
            runId: run.runId,
            userId: run.userId,
            strategyId: run.strategyId,
            symbol,
            leg: "d2_flatten",
            extra: { flattenQty, correlationId: flattenCorrelationId },
          });
          await persistTplTradeExitUiHint(run.runId, {
            reason: "wipeout_triggered",
            at: new Date().toISOString(),
            leg: "d2_flatten",
          });
        }
      }
      if (!(d2NetQtyAbs > 1e-8 && run.secondaryExchangeConnectionId && flattenDispatchOk)) {
        const d1Reason = inferD1TplExitReasonFromMark(mark, runtime.d1);
        logTplTradeExited({
          reason: d1Reason,
          runId: run.runId,
          userId: run.userId,
          strategyId: run.strategyId,
          symbol,
          leg: "d1",
        });
        await persistTplTradeExitUiHint(run.runId, {
          reason: d1Reason,
          at: new Date().toISOString(),
          leg: "d1",
        });
      }
      runtime.lastCompletedD1FlipDirection = runtime.d1.side;
      runtime.d1 = undefined;
      runtime.d1BaseQtyInt = undefined;
      runtime.d2TriggeredSteps = [];
      runtime.d2StepLastEntries = {};
      runtime.d2StepsState = {};
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
    }

    const actualOpenPositionSide: "LONG" | "SHORT" | null = hasOpenD1
      ? (netQty > 0 ? "LONG" : "SHORT")
      : null;
    if (
      actualOpenPositionSide &&
      runtime.lastCompletedD1FlipDirection !== actualOpenPositionSide
    ) {
      const prevDirection = runtime.lastCompletedD1FlipDirection ?? null;
      runtime.lastCompletedD1FlipDirection = actualOpenPositionSide;
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
      tradingLog("warn", "tpl_trend_direction_force_synced_to_open_position", {
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        previousDirection: prevDirection,
        syncedDirection: actualOpenPositionSide,
      });
    }
    const d1EntrySide: "LONG" | "SHORT" =
      actualOpenPositionSide ?? (flipDirection === "UP" ? "LONG" : "SHORT");
    const isDuplicateTick =
      !isForcedMockFlip && latestClosedBarTime === runtime.lastFlipCandleTime;
    const isSameDirectionBlock =
      !isForcedMockFlip && d1EntrySide === runtime.lastCompletedD1FlipDirection;
    const hasOpenD1Position = hasOpenD1;
    const isPostWipeoutSameTickBlock = clearedStaleD1RuntimeThisTick;
    const prospectiveD1TargetPx = targetPrice(mark, d1EntrySide, cfg.d1TargetPct);
    const prospectiveD1TargetDistance = Math.abs(prospectiveD1TargetPx - mark);
    const prospectiveD2JourneyUsable =
      Number.isFinite(mark) &&
      mark > 0 &&
      Number.isFinite(prospectiveD1TargetPx) &&
      prospectiveD1TargetDistance > Math.max(1e-8, 1e-12 * Math.abs(mark));

    if (isFlip) {
      const entryMatrixPass =
        !isPostWipeoutSameTickBlock &&
        !isDuplicateTick &&
        !isSameDirectionBlock &&
        !hasOpenD1Position;
      if (!entryMatrixPass) {
        tradingLog("info", "tpl_entry_rejected_debug", {
          event: "tpl_entry_rejected_debug",
          rejectReason: "entry_guardrails",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          halfTrendFreshFlipOnLatestClosed: true,
          isDuplicateTick,
          isSameDirectionBlock,
          hasOpenD1Position,
          isPostWipeoutSameTickBlock,
          latestClosedBarTime,
          lastFlipCandleTime: runtime.lastFlipCandleTime ?? null,
          d1EntrySide,
          lastCompletedD1FlipDirection: runtime.lastCompletedD1FlipDirection ?? null,
          halftrendTrendLatestClosed: htLatestClosed?.trend ?? null,
          halftrendTrendPreviousClosed: htPreviousClosed?.trend ?? null,
          isForcedMockFlip,
          prospectiveD1TargetPx,
          prospectiveD1TargetDistance,
          prospectiveD2JourneyUsable,
        });
      }
    }

    const passesFlipCandleGuard =
      isForcedMockFlip || latestClosedBarTime !== runtime.lastFlipCandleTime;
    const passesDirectionGuard =
      isForcedMockFlip || d1EntrySide !== runtime.lastCompletedD1FlipDirection;
    if (
      isFlip &&
      !manualCloseEntryBlock &&
      !clearedStaleD1RuntimeThisTick &&
      passesFlipCandleGuard &&
      passesDirectionGuard &&
      !hasOpenD1
    ) {
      if (!run.primaryExchangeConnectionId) {
        tradingLog("warn", "tpl_d1_missing_primary_exchange", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
        });
        tradingLog("info", "tpl_entry_rejected_debug", {
          event: "tpl_entry_rejected_debug",
          rejectReason: "missing_primary_exchange",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          halfTrendFreshFlipOnLatestClosed: true,
          isDuplicateTick,
          isSameDirectionBlock,
          hasOpenD1Position,
          isPostWipeoutSameTickBlock,
          prospectiveD1TargetDistance,
          prospectiveD2JourneyUsable,
        });
      } else {
        const capitalUsd = resolveFinalAllocatedCapitalUsd({
          runSettingsJson: run.runSettingsJson,
          columnCapital: run.capitalToUseInr,
          recommendedCapitalInr: run.recommendedCapitalInr,
        });
        const levStr = resolveRawLeverageStringForExecution({
          runSettingsJson: run.runSettingsJson,
          columnLeverage: run.leverage != null ? String(run.leverage) : null,
          strategyMaxLeverage: run.strategyMaxLeverage != null ? String(run.strategyMaxLeverage) : null,
        });
        const leverageEff = Math.max(1, n(levStr) || 1);
        const rawContractValue = await fetchDeltaIndiaProductContractValue(symbol);
        const contractValueUsd = normalizeUsdContractValue(rawContractValue, mark);
        const collateralUsd = Math.max(0, (capitalUsd ?? 0) * (cfg.d1CapitalAllocationPct / 100));
        const targetNotionalUsd = collateralUsd * leverageEff;
        const minContracts = await fetchDeltaIndiaProductMinOrderContracts(symbol);
        const qty = Math.max(
          minContracts ?? 1,
          Math.floor(targetNotionalUsd / Math.max(contractValueUsd, 1e-9)),
        );
        tradingLog("info", "tpl_qty_calc_debug", {
          event: "tpl_qty_calc_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          allocatedCapitalUsd: capitalUsd ?? null,
          leverageEff,
          rawContractValue,
          contractValueUsd,
          minContracts: minContracts ?? null,
          targetNotionalUsd,
          finalQty: qty,
        });
        const runSettingsProbe = userStrategyRunSettingsJsonSchema.safeParse(
          run.runSettingsJson ?? {},
        );
        const parsedRs = parseUserStrategyRunSettingsJson(run.runSettingsJson);
        const rawRoot =
          run.runSettingsJson && typeof run.runSettingsJson === "object"
            ? (run.runSettingsJson as Record<string, unknown>)
            : null;
        const rawEx = rawRoot?.execution;
        const rawExecutionSnippet =
          rawEx && typeof rawEx === "object"
            ? {
                allocatedCapitalUsd: (rawEx as Record<string, unknown>).allocatedCapitalUsd,
                leverage: (rawEx as Record<string, unknown>).leverage,
              }
            : null;
        tradingLog("info", "tpl_d1_sizing_inputs", {
          event: "tpl_d1_sizing_inputs",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          runSettingsJsonZodOk: runSettingsProbe.success,
          parsedExecutionAllocated: parsedRs.execution?.allocatedCapitalUsd ?? null,
          parsedExecutionLeverage: parsedRs.execution?.leverage ?? null,
          rawExecutionSnippet,
          columnCapital: run.capitalToUseInr,
          columnLeverage: run.leverage,
          capitalUsdResolved: capitalUsd,
          levStr,
          leverageEff,
          d1CapitalAllocationPct: cfg.d1CapitalAllocationPct,
          collateralUsd,
          targetNotionalUsd,
          contractValueUsd,
          qty,
          minContracts: minContracts ?? null,
        });
        if (qty <= 0) {
          tradingLog("info", "tpl_entry_rejected_debug", {
            event: "tpl_entry_rejected_debug",
            rejectReason: "zero_or_non_positive_qty",
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            halfTrendFreshFlipOnLatestClosed: true,
            isDuplicateTick,
            isSameDirectionBlock,
            hasOpenD1Position,
            isPostWipeoutSameTickBlock,
            qty,
            collateralUsd,
            targetNotionalUsd,
            leverageEff,
            capitalUsd: capitalUsd ?? null,
            d1CapitalAllocationPct: cfg.d1CapitalAllocationPct,
            contractValueRaw: rawContractValue,
            contractValueUsd,
            minContracts: minContracts ?? null,
            mark,
            prospectiveD1TargetDistance,
            prospectiveD2JourneyUsable,
          });
        }
        if (qty > 0) {
          const d1Side = d1EntrySide;
          const correlationId = `tpl_d1_${run.runId}_${latestClosedBarTime}_${d1Side.toLowerCase()}`;
          let dispatch: StrategySignalIntakeResponse;
          try {
            dispatch = await dispatchStrategyExecutionSignal({
              strategyId: run.strategyId,
              correlationId,
              symbol,
              side: d1Side === "LONG" ? "buy" : "sell",
              orderType: "market",
              quantity: fmtQty(qty),
              actionType: "entry",
              executionMode: "live_only",
              targetRunIds: [run.runId],
              exchangeVenue: "primary",
              metadata: {
                source: "trend_profit_lock_poller",
                leg: "d1_anchor",
                force_signal_quantity: true,
                mark_price: mark,
                timeframe: resolution,
                halftrend_flip_time: latestClosedBarTime,
              },
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            dispatch = { ok: false, error: `dispatch_exception: ${msg.slice(0, 400)}` };
          }
          tradingLog(dispatch.ok ? "info" : "warn", "tpl_d1_entry_dispatch", {
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            qty,
            side: d1Side,
            mark,
            collateralUsd,
            targetNotionalUsd,
            leverageEff,
            contractValueRaw: rawContractValue,
            contractValueUsd,
            ok: dispatch.ok,
            jobsEnqueued: dispatch.ok ? dispatch.liveJobsEnqueued : 0,
            error: dispatch.ok ? null : dispatch.error,
          });
          const liveEnqueued = dispatch.ok ? (dispatch.liveJobsEnqueued ?? 0) : 0;
          if (dispatch.ok && liveEnqueued > 0) {
            runtime.d1 = {
              side: d1Side,
              entryPrice: mark,
              targetPrice: targetPrice(mark, d1Side, cfg.d1TargetPct),
              stoplossPrice: stoplossPrice(mark, d1Side, cfg.d1StoplossPct),
              breakevenTriggerPct: cfg.d1BreakevenTriggerPct,
            };
            runtime.d1BaseQtyInt = Math.max(1, Math.floor(Math.abs(qty)));
            runtime.d2StepLastEntries = {};
            runtime.lastFlipCandleTime = latestClosedBarTime;
            await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
          } else {
            tradingLog("warn", "tpl_d1_entry_runtime_not_committed", {
              runId: run.runId,
              strategyId: run.strategyId,
              userId: run.userId,
              symbol,
              latestClosedBarTime,
              dispatchOk: dispatch.ok,
              liveJobsEnqueued: liveEnqueued,
              error: dispatch.ok ? null : dispatch.error,
              reason:
                !dispatch.ok
                  ? "dispatch_failed"
                  : liveEnqueued <= 0
                    ? "no_live_jobs_enqueued"
                    : "unknown",
            });
          }
        }
      }
    }

    if (!hasOpenD1) continue;

    const d1Side: "LONG" | "SHORT" = netQty > 0 ? "LONG" : "SHORT";
    const entryPx =
      Number.isFinite(n(d1Pos?.avgEntry)) && n(d1Pos?.avgEntry) > 0 ? n(d1Pos?.avgEntry) : runtime.d1?.entryPrice ?? mark;
    const d1TargetPx = targetPrice(entryPx, d1Side, cfg.d1TargetPct);
    const d1StopPx = stoplossPrice(entryPx, d1Side, cfg.d1StoplossPct);

    // Ensure protective stop exists and track exact order ID for later amendment.
    if (!runtime.d1?.stopLossOrderExternalId && run.primaryExchangeConnectionId) {
      const adapterRes = await resolveRunExchangeAdapter(run.primaryExchangeConnectionId);
      const stopSide = d1Side === "LONG" ? "sell" : "buy";
      if (adapterRes.ok && adapterRes.adapter.placeReduceOnlyStopLoss) {
        const stopClientId = generateInternalClientOrderId();
        let stopPlace: { ok: true; externalOrderId: string } | { ok: false; error: string };
        try {
          stopPlace = await adapterRes.adapter.placeReduceOnlyStopLoss({
            internalClientOrderId: stopClientId,
            symbol,
            side: stopSide,
            quantity: fmtQty(Math.max(1, Math.floor(Math.abs(netQty)))),
            stopPrice: String(d1StopPx),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          stopPlace = { ok: false, error: `placeReduceOnlyStopLoss_exception: ${msg.slice(0, 400)}` };
        }
        if (stopPlace.ok) {
          await updateRuntimeOrderId(run.runId, "d1_stop_loss_external_id", stopPlace.externalOrderId);
          runtime.d1 = {
            side: d1Side,
            entryPrice: entryPx,
            targetPrice: d1TargetPx,
            stoplossPrice: d1StopPx,
            breakevenTriggerPct: cfg.d1BreakevenTriggerPct,
            breakevenQueuedAt: runtime.d1?.breakevenQueuedAt,
            breakevenExecutedAt: runtime.d1?.breakevenExecutedAt,
            breakevenOrderCorrelationId: runtime.d1?.breakevenOrderCorrelationId,
            stopLossOrderExternalId: stopPlace.externalOrderId,
            stopLossOrderClientId: stopClientId,
            stopLossPlacedAt: new Date().toISOString(),
          };
          await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
          tradingLog("info", "tpl_d1_stoploss_order_placed", {
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            stopOrderId: stopPlace.externalOrderId,
            stopPrice: d1StopPx,
          });
        } else {
          tradingLog("warn", "tpl_d1_stoploss_order_place_failed", {
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            error: stopPlace.error,
          });
        }
      } else {
        tradingLog("warn", "tpl_d1_stoploss_adapter_unavailable", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          error: adapterRes.ok ? "placeReduceOnlyStopLoss_not_implemented" : adapterRes.error,
        });
      }
    }

    const favorableMove = favorableDistance(entryPx, mark, d1Side);
    const d1JourneyDistance = Math.abs(d1TargetPx - entryPx);
    const movedTowardTargetPct =
      d1JourneyDistance > 1e-8 ? (Math.max(0, favorableMove) / d1JourneyDistance) * 100 : 0;
    const prospectiveD1StopLossPx = entryPx;
    if (movedTowardTargetPct >= cfg.d1BreakevenTriggerPct && !runtime.d1?.breakevenExecutedAt) {
      const existingStopId = runtime.d1?.stopLossOrderExternalId ?? null;
      const adapterRes = await resolveRunExchangeAdapter(run.primaryExchangeConnectionId);
      const amendAttempted = Boolean(existingStopId) && adapterRes.ok && Boolean(adapterRes.adapter.amendStopLossOrder);
      let amendOk = false;
      let amendError: string | null = null;
      let amendedStopOrderId: string | null = null;
      if (amendAttempted) {
        let amend: { ok: true; externalOrderId: string } | { ok: false; error: string };
        try {
          amend = await adapterRes.adapter.amendStopLossOrder!({
            existingExternalOrderId: existingStopId!,
            replacementInternalClientOrderId: generateInternalClientOrderId(),
            symbol,
            side: d1Side === "LONG" ? "sell" : "buy",
            quantity: fmtQty(Math.max(1, Math.floor(Math.abs(netQty)))),
            newStopPrice: String(prospectiveD1StopLossPx),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          amend = { ok: false, error: `amendStopLossOrder_exception: ${msg.slice(0, 400)}` };
        }
        amendOk = amend.ok;
        amendError = amend.ok ? null : amend.error;
        amendedStopOrderId = amend.ok ? amend.externalOrderId : null;
      } else {
        amendError = !existingStopId
          ? "missing_existing_stop_order_id"
          : adapterRes.ok
            ? "adapter_amendStopLossOrder_not_implemented"
            : adapterRes.error;
      }

      tradingLog(amendOk ? "info" : "warn", "tpl_d1_breakeven_update_queued", {
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        side: d1Side,
        entryPrice: entryPx,
        currentMark: mark,
        triggerPct: cfg.d1BreakevenTriggerPct,
        movedTowardTargetPct,
        favorableMove,
        d1JourneyDistance,
        newStopPrice: prospectiveD1StopLossPx,
        existingStopOrderId: existingStopId,
        amendedStopOrderId,
        ok: amendOk,
        error: amendError,
      });
      runtime.d1 = {
        side: d1Side,
        entryPrice: entryPx,
        targetPrice: d1TargetPx,
        stoplossPrice: amendOk ? prospectiveD1StopLossPx : runtime.d1?.stoplossPrice ?? d1StopPx,
        breakevenTriggerPct: cfg.d1BreakevenTriggerPct,
        breakevenQueuedAt: new Date().toISOString(),
        breakevenExecutedAt: amendOk ? new Date().toISOString() : undefined,
        breakevenOrderCorrelationId: runtime.d1?.breakevenOrderCorrelationId,
        stopLossOrderExternalId: amendedStopOrderId ?? runtime.d1?.stopLossOrderExternalId,
        stopLossOrderClientId: runtime.d1?.stopLossOrderClientId,
        stopLossPlacedAt: runtime.d1?.stopLossPlacedAt,
      };
      if (amendOk && amendedStopOrderId) {
        await updateRuntimeOrderId(run.runId, "d1_stop_loss_external_id", amendedStopOrderId);
      }
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
      if (amendOk) {
        tradingLog("info", "tpl_d1_breakeven_stop_amended", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          movedTowardTargetPct,
          favorableMove,
          triggerPct: cfg.d1BreakevenTriggerPct,
          oldStopOrderId: existingStopId,
          newStopOrderId: amendedStopOrderId,
        });
      }
    }

    const d2States = runtime.d2StepsState ?? {};
    const d2StepLastEntries: Record<string, number> = { ...(runtime.d2StepLastEntries ?? {}) };
    const triggered = new Set(runtime.d2TriggeredSteps ?? []);
    const secondaryAdapter = run.secondaryExchangeConnectionId
      ? await resolveRunExchangeAdapter(run.secondaryExchangeConnectionId)
      : { ok: false as const, error: "missing_secondary_exchange" };
    const d2OpenQtyTracked = Object.values(d2States)
      .filter((s) => s.status === "open")
      .reduce((sum, s) => sum + s.qty, 0);
    for (const state of Object.values(d2States)) {
      if (state.status !== "open") continue;
      const hitTarget =
        state.side === "LONG" ? mark >= state.targetPrice : mark <= state.targetPrice;
      const hitStop =
        state.side === "LONG" ? mark <= state.stoplossPrice : mark >= state.stoplossPrice;
      if (hitTarget || hitStop) {
        const exitSide = state.side === "LONG" ? "sell" : "buy";
        const exitQtyEstimated = estimateStepLiveQtyForExit({
          stateQty: state.qty,
          d2OpenQtyTracked,
          d2NetQtyAbs,
        });
        const exitQty = Math.max(1, exitQtyEstimated);
        const exitCorrelationId = `tpl_d2_exit_step_${state.step}_${run.runId}_${Date.now()}`;
        let exitDispatch: StrategySignalIntakeResponse;
        try {
          exitDispatch = await dispatchStrategyExecutionSignal({
            strategyId: run.strategyId,
            correlationId: exitCorrelationId,
            symbol,
            side: exitSide,
            orderType: "market",
            quantity: fmtQty(exitQty),
            actionType: "exit",
            executionMode: "live_only",
            targetRunIds: [run.runId],
            exchangeVenue: "secondary",
            metadata: {
              source: "trend_profit_lock_poller",
              leg: `d2_step_${state.step}`,
              reason: hitTarget ? "target_hit" : "stoploss_hit",
              force_signal_quantity: true,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          exitDispatch = { ok: false, error: `dispatch_exception: ${msg.slice(0, 400)}` };
        }
        const exitLiveJobs = exitDispatch.ok ? (exitDispatch.liveJobsEnqueued ?? 0) : 0;
        tradingLog(exitDispatch.ok ? "info" : "warn", "tpl_d2_exit_dispatch", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: state.step,
          side: state.side,
          markPrice: mark,
          targetPrice: state.targetPrice,
          stoplossPrice: state.stoplossPrice,
          hitTarget,
          hitStop,
          d2NetQtyAbs,
          d2OpenQtyTracked,
          stateQtyConfigured: state.qty,
          exitQtyEstimated,
          exitQty,
          correlationId: exitCorrelationId,
          dispatchOk: exitDispatch.ok,
          liveJobsEnqueued: exitLiveJobs,
          dispatchError: exitDispatch.ok ? null : exitDispatch.error,
        });
        if (exitDispatch.ok && exitLiveJobs > 0) {
          if (secondaryAdapter.ok && secondaryAdapter.adapter.cancelOrdersByPriceMatch) {
            const surgical = await secondaryAdapter.adapter.cancelOrdersByPriceMatch({
              symbol,
              targetPrices: [state.targetPrice],
              stopPrices: [state.stoplossPrice],
              toleranceBps: 1,
            });
            tradingLog(surgical.ok ? "info" : "warn", "tpl_d2_surgical_price_match_cancel", {
              runId: run.runId,
              strategyId: run.strategyId,
              userId: run.userId,
              symbol,
              step: state.step,
              targetPrice: state.targetPrice,
              stoplossPrice: state.stoplossPrice,
              toleranceBps: 1,
              ok: surgical.ok,
              cancelledCount: surgical.ok ? surgical.cancelledCount : 0,
              attemptedCount: surgical.ok ? surgical.attemptedCount : 0,
              error: surgical.ok ? null : surgical.error,
              raw: surgical.raw ?? null,
            });
          }
          state.status = "closed";
          state.closeReason = hitTarget ? "target" : "stoploss";
          state.closedAt = new Date().toISOString();
          const stepReason = hitTarget ? "d2_step_target_hit" : "d2_step_stoploss_hit";
          logTplTradeExited({
            reason: stepReason,
            runId: run.runId,
            userId: run.userId,
            strategyId: run.strategyId,
            symbol,
            leg: `d2_step_${state.step}`,
            extra: { step: state.step, closeReason: state.closeReason },
          });
          await persistTplTradeExitUiHint(run.runId, {
            reason: stepReason,
            at: state.closedAt,
            leg: `d2_step_${state.step}`,
          });
          triggered.delete(state.step);
          if (state.closeReason === "stoploss") {
            state.slHitLock = true;
            state.rearmTriggerPrice = state.triggerPrice;
            state.rearmSeenAway = false;
            d2States[String(state.step)] = state;
            tradingLog("warn", "tpl_d2_step_sl_lock_engaged", {
              runId: run.runId,
              strategyId: run.strategyId,
              userId: run.userId,
              symbol,
              step: state.step,
              triggerPrice: state.triggerPrice,
            });
          } else {
            delete d2States[String(state.step)];
            tradingLog("info", "tpl_d2_step_reentry_reset_ready", {
              runId: run.runId,
              strategyId: run.strategyId,
              userId: run.userId,
              symbol,
              step: state.step,
              closeReason: state.closeReason,
            });
          }
          continue;
        }
      }
      const expectedOpenWithoutStep = Math.max(0, d2OpenQtyTracked - state.qty);
      const stepLooksClosedOnExchange = d2NetQtyAbs <= expectedOpenWithoutStep + 1e-8;
      if (!stepLooksClosedOnExchange) continue;
      const hitTargetOnSync =
        state.side === "LONG" ? mark >= state.targetPrice : mark <= state.targetPrice;
      const hitStopOnSync =
        state.side === "LONG" ? mark <= state.stoplossPrice : mark >= state.stoplossPrice;
      state.status = "closed";
      state.closeReason = hitTargetOnSync ? "target" : hitStopOnSync ? "stoploss" : "unknown";
      state.closedAt = new Date().toISOString();
      if (secondaryAdapter.ok && secondaryAdapter.adapter.cancelOrdersByPriceMatch) {
        const surgical = await secondaryAdapter.adapter.cancelOrdersByPriceMatch({
          symbol,
          targetPrices: [state.targetPrice],
          stopPrices: [state.stoplossPrice],
          toleranceBps: 1,
        });
        tradingLog(surgical.ok ? "info" : "warn", "tpl_d2_surgical_price_match_cancel", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: state.step,
          targetPrice: state.targetPrice,
          stoplossPrice: state.stoplossPrice,
          toleranceBps: 1,
          source: "exchange_sync_step_flat",
          ok: surgical.ok,
          cancelledCount: surgical.ok ? surgical.cancelledCount : 0,
          attemptedCount: surgical.ok ? surgical.attemptedCount : 0,
          error: surgical.ok ? null : surgical.error,
          raw: surgical.raw ?? null,
        });
      }
      {
        const stepReason = hitTargetOnSync ? "d2_step_target_hit" : "d2_step_stoploss_hit";
        logTplTradeExited({
          reason: stepReason,
          runId: run.runId,
          userId: run.userId,
          strategyId: run.strategyId,
          symbol,
          leg: `d2_step_${state.step}`,
          extra: { step: state.step, closeReason: state.closeReason },
        });
        await persistTplTradeExitUiHint(run.runId, {
          reason: stepReason,
          at: state.closedAt,
          leg: `d2_step_${state.step}`,
        });
      }
      triggered.delete(state.step);
      const shouldLockAfterVenueExit = state.closeReason === "stoploss";
      if (shouldLockAfterVenueExit) {
        state.slHitLock = true;
        state.rearmTriggerPrice = state.triggerPrice;
        state.rearmSeenAway = false;
        d2States[String(state.step)] = state;
        tradingLog("warn", "tpl_d2_step_sl_lock_engaged", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: state.step,
          closeReason: state.closeReason,
          triggerPrice: state.triggerPrice,
          source: "venue_automated_exit",
        });
      } else {
        delete d2States[String(state.step)];
        tradingLog("info", "tpl_d2_step_reentry_reset_ready", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: state.step,
          closeReason: state.closeReason,
          source: "venue_automated_exit_non_stoploss",
        });
      }
    }
    for (const [stepKey, state] of Object.entries(d2States)) {
      if (state.status !== "closed") continue;
      if (state.slHitLock) continue;
      // Defensive scrub for non-locked closed states.
      delete d2States[stepKey];
      triggered.delete(state.step);
      tradingLog("info", "tpl_d2_closed_state_scrubbed_for_reload", {
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        step: state.step,
        closeReason: state.closeReason ?? null,
      });
    }

    const d1TargetDistance = Math.abs(d1TargetPx - entryPx);
    const d2JourneyUsable =
      Number.isFinite(entryPx) &&
      Number.isFinite(d1TargetPx) &&
      d1TargetDistance > Math.max(1e-8, 1e-12 * Math.abs(entryPx));
    if (!d2JourneyUsable) {
      tradingLog("warn", "tpl_d2_skipped_degenerate_target_journey", {
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        entryPx,
        d1TargetPx,
        d1TargetDistance,
        d1TargetPct: cfg.d1TargetPct,
      });
    }
    const highestReachedStep = cfg.d2Steps.reduce((maxStep, stepCfg) => {
      const stepJourneyDistance = d1TargetDistance * (stepCfg.stepTriggerPct / 100);
      const triggerPx = d1Side === "LONG" ? entryPx + stepJourneyDistance : entryPx - stepJourneyDistance;
      const reached = d1Side === "LONG" ? mark >= triggerPx : mark <= triggerPx;
      return reached ? Math.max(maxStep, stepCfg.step) : maxStep;
    }, 0);
    for (const step of cfg.d2Steps) {
      const existingState = d2States[String(step.step)];
      const stepJourneyDistance = d1TargetDistance * (step.stepTriggerPct / 100);
      const triggerPx = d1Side === "LONG" ? entryPx + stepJourneyDistance : entryPx - stepJourneyDistance;
      if (existingState?.status === "closed" && existingState.slHitLock) {
        const lockTriggerPx = existingState.rearmTriggerPrice ?? triggerPx;
        const awayDist = d2StepRearmAwayDistance({
          entryPx,
          triggerPx: lockTriggerPx,
          d1TargetDistance,
        });
        const movedAway = d1Side === "LONG" ? mark >= lockTriggerPx + awayDist : mark <= lockTriggerPx - awayDist;
        if (movedAway && !existingState.rearmSeenAway) {
          existingState.rearmSeenAway = true;
          d2States[String(step.step)] = existingState;
          tradingLog("info", "tpl_d2_step_sl_lock_away_seen", {
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            step: step.step,
            lockTriggerPx,
            awayDistance: awayDist,
            markPrice: mark,
          });
        }
        const reCrossed = d1Side === "LONG" ? mark <= lockTriggerPx : mark >= lockTriggerPx;
        if (!(existingState.rearmSeenAway && reCrossed)) {
          tradingLog("info", "tpl_d2_dispatch_blocked_debug", {
            event: "tpl_d2_dispatch_blocked_debug",
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            step: step.step,
            blockedReason: "sl_lock_active",
            lockTriggerPx,
            awayDistance: awayDist,
            markPrice: mark,
            rearmSeenAway: existingState.rearmSeenAway ?? false,
          });
          continue;
        }
        // Unlock this step only after away-and-back cycle.
        delete d2States[String(step.step)];
        tradingLog("info", "tpl_d2_step_sl_lock_cleared", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          lockTriggerPx,
          markPrice: mark,
        });
      }
      if (
        existingState?.status === "open" ||
        existingState?.status === "drafting" ||
        existingState?.status === "submitting"
      ) {
        tradingLog("info", "tpl_d2_dispatch_blocked_debug", {
          event: "tpl_d2_dispatch_blocked_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          blockedReason: "in_flight_or_open",
          existingStateStatus: existingState?.status ?? null,
        });
        continue;
      }
      if (!d2JourneyUsable) {
        tradingLog("warn", "tpl_d2_dispatch_blocked_debug", {
          event: "tpl_d2_dispatch_blocked_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          blockedReason: "d2_journey_not_usable",
          entryPrice: entryPx,
          d1TargetPrice: d1TargetPx,
          d1TargetDistance,
        });
        continue;
      }
      // Catch-up dispatch: once market has reached step N, evaluate all steps <= N.
      if (!(highestReachedStep > 0 && step.step <= highestReachedStep)) {
        tradingLog("info", "tpl_d2_dispatch_blocked_debug", {
          event: "tpl_d2_dispatch_blocked_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          blockedReason: "trigger_not_reached",
          stepTriggerPct: step.stepTriggerPct,
          triggerPrice: triggerPx,
          markPrice: mark,
          d1Side,
          highestReachedStep,
        });
        continue;
      }

      const d1QtyIntFallback = Math.max(0, Math.floor(Math.abs(netQty)));
      const baseD1QtyForMath = Math.max(
        0,
        Math.floor(Number(runtime.d1BaseQtyInt ?? d1QtyIntFallback)),
      );
      if (baseD1QtyForMath < 1) {
        tradingLog("warn", "tpl_d2_skipped_no_d1_contracts", {
          runId: run.runId,
          step: step.step,
          d1QtyIntFallback,
          d1BaseQtyInt: runtime.d1BaseQtyInt ?? null,
          baseD1QtyForMath,
        });
        tradingLog("warn", "tpl_d2_dispatch_blocked_debug", {
          event: "tpl_d2_dispatch_blocked_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          blockedReason: "no_d1_contracts",
          d1QtyIntFallback,
          d1BaseQtyInt: runtime.d1BaseQtyInt ?? null,
          baseD1QtyForMath,
        });
        continue;
      }
      const minContracts = await fetchDeltaIndiaProductMinOrderContracts(symbol);
      const floorPctQty = Math.floor(baseD1QtyForMath * (step.stepQtyPctOfD1 / 100));
      const d2Qty = Math.max(minContracts ?? 1, floorPctQty);
      tradingLog("info", "tpl_d2_sizing_audit", {
        event: "tpl_d2_sizing_audit",
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        step: step.step,
        d1BaseQtyForMath: baseD1QtyForMath,
        d1BaseQtyIntRuntime: runtime.d1BaseQtyInt ?? null,
        d1QtyIntFallback,
        stepPct: step.stepQtyPctOfD1,
        floorPctQty,
        minContracts: minContracts ?? null,
        d2Qty,
      });
      tradingLog("info", "tpl_d2_qty_calc_debug", {
        event: "tpl_d2_qty_calc_debug",
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        step: step.step,
        d1QtyInt: baseD1QtyForMath,
        d1QtyIntFallback,
        d1BaseQtyIntRuntime: runtime.d1BaseQtyInt ?? null,
        stepQtyPctOfD1: step.stepQtyPctOfD1,
        floorPctQty,
        minContracts: minContracts ?? null,
        finalD2Qty: d2Qty,
      });
      if (!(d2Qty > 0)) {
        tradingLog("warn", "tpl_d2_dispatch_blocked_debug", {
          event: "tpl_d2_dispatch_blocked_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          blockedReason: "non_positive_d2_qty",
          d1QtyInt: baseD1QtyForMath,
          d1QtyIntFallback,
          d1BaseQtyIntRuntime: runtime.d1BaseQtyInt ?? null,
          floorPctQty,
          minContracts: minContracts ?? null,
          finalD2Qty: d2Qty,
        });
        continue;
      }
      const d2Side = oppositeSide(d1Side);
      const requiredLinkedStep = parseLinkedStepFromTargetType(step.targetLinkType);
      if (requiredLinkedStep != null) {
        const liveLinked = d2States[String(requiredLinkedStep)];
        const linkedFromLive =
          !!liveLinked &&
          Number.isFinite(liveLinked.entryMarkPrice) &&
          liveLinked.entryMarkPrice > 0;
        const linkedFromHistory =
          Number.isFinite(d2StepLastEntries[String(requiredLinkedStep)]) &&
          Number(d2StepLastEntries[String(requiredLinkedStep)]) > 0;
        if (!linkedFromLive && !linkedFromHistory) {
          tradingLog("warn", "tpl_d2_dispatch_blocked_debug", {
            event: "tpl_d2_dispatch_blocked_debug",
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            step: step.step,
            blockedReason: "missing_linked_step_entry",
            targetLinkType: step.targetLinkType,
            requiredLinkedStep,
          });
          continue;
        }
      }
      const linkedTarget = resolveLinkedTargetPrice({
        d1EntryPrice: entryPx,
        markPrice: mark,
        d1Side,
        d1TargetDistance,
        targetLinkType: step.targetLinkType,
        d2ConfigSteps: cfg.d2Steps.map((s) => ({ step: s.step, stepTriggerPct: s.stepTriggerPct })),
        d2States,
        d2StepLastEntries,
      });
      if (!Number.isFinite(linkedTarget.price) || !(linkedTarget.price > 0)) {
        tradingLog("warn", "tpl_d2_skipped_invalid_linked_target", {
          runId: run.runId,
          step: step.step,
          targetLinkType: step.targetLinkType,
          linkedStep: linkedTarget.linkedStep,
          fallbackUsed: linkedTarget.fallbackUsed,
        });
        tradingLog("warn", "tpl_d2_dispatch_blocked_debug", {
          event: "tpl_d2_dispatch_blocked_debug",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          blockedReason: "invalid_or_missing_linked_target",
          targetLinkType: step.targetLinkType,
          linkedStep: linkedTarget.linkedStep,
          fallbackUsed: linkedTarget.fallbackUsed,
          resolvedTargetPrice: linkedTarget.price,
        });
        continue;
      }
      if (linkedTarget.fallbackUsed) {
        tradingLog("warn", "tpl_d2_target_link_missing_used_theoretical_fallback", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          targetLinkType: step.targetLinkType,
          fallbackTargetPrice: linkedTarget.price,
          linkedStep: linkedTarget.linkedStep,
        });
      }
      const correlationId = `tpl_d2_step_${step.step}_${run.runId}_${Date.now()}`;
      d2States[String(step.step)] = {
        step: step.step,
        triggerPrice: triggerPx,
        entryMarkPrice: mark,
        side: d2Side,
        qty: d2Qty,
        targetPrice: linkedTarget.price,
        stoplossPrice: d2StoplossFromD1Distance({
          d2EntryPrice: mark,
          d2Side,
          d1TargetDistance,
          stepStoplossPct: step.stepStoplossPct,
        }),
        executedAt: new Date().toISOString(),
        correlationId,
        status: "submitting",
      };
      triggered.add(step.step);
      let d2Dispatch: StrategySignalIntakeResponse;
      try {
        d2Dispatch = await dispatchStrategyExecutionSignal({
          strategyId: run.strategyId,
          correlationId,
          symbol,
          side: d2Side === "LONG" ? "buy" : "sell",
          orderType: "market",
          quantity: fmtQty(d2Qty),
          actionType: "entry",
          executionMode: "live_only",
          targetRunIds: [run.runId],
          exchangeVenue: "secondary",
          metadata: {
            source: "trend_profit_lock_poller",
            leg: `d2_step_${step.step}`,
            force_signal_quantity: true,
            explicit_leg_quantity: true,
            step: step.step,
            step_target_link_type: step.targetLinkType,
            step_stoploss_pct: step.stepStoplossPct,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        d2Dispatch = { ok: false, error: `dispatch_exception: ${msg.slice(0, 400)}` };
      }
      tradingLog(d2Dispatch.ok ? "info" : "warn", "tpl_d2_trigger_reached", {
        event: "tpl_d2_trigger_reached",
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        symbol,
        step: step.step,
        stepTriggerPct: step.stepTriggerPct,
        entryPrice: entryPx,
        triggerPrice: triggerPx,
        markPrice: mark,
        qty: d2Qty,
        side: d2Side,
        targetLinkType: step.targetLinkType,
        resolvedTargetPrice: linkedTarget.price,
        dispatchOk: d2Dispatch.ok,
        liveJobsEnqueued: d2Dispatch.ok ? d2Dispatch.liveJobsEnqueued : 0,
        dispatchError: d2Dispatch.ok ? null : d2Dispatch.error,
      });
      const d2LiveJobs = d2Dispatch.ok ? (d2Dispatch.liveJobsEnqueued ?? 0) : 0;
      if (!d2Dispatch.ok || d2LiveJobs <= 0) {
        delete d2States[String(step.step)];
        triggered.delete(step.step);
        tradingLog("error", "tpl_d2_execution_failed", {
          event: "tpl_d2_execution_failed",
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: step.step,
          correlationId,
          qty: d2Qty,
          dispatchOk: d2Dispatch.ok,
          liveJobsEnqueued: d2LiveJobs,
          reason: !d2Dispatch.ok ? "dispatch_failed" : "no_live_jobs_enqueued",
          error: d2Dispatch.ok ? null : d2Dispatch.error,
        });
        continue;
      }
      d2States[String(step.step)] = {
        step: step.step,
        triggerPrice: triggerPx,
        entryMarkPrice: mark,
        side: d2Side,
        qty: d2Qty,
        targetPrice: linkedTarget.price,
        stoplossPrice: d2StoplossFromD1Distance({
          d2EntryPrice: mark,
          d2Side,
          d1TargetDistance,
          stepStoplossPct: step.stepStoplossPct,
        }),
        executedAt: new Date().toISOString(),
        correlationId,
        status: "open",
      };
      d2StepLastEntries[String(step.step)] = mark;
      await tryRecordExecutionLogByCorrelation({
        correlationId,
        runId: run.runId,
        exchangeConnectionId: run.secondaryExchangeConnectionId,
        message: "tpl_d2_step_execution_dispatched",
        payload: {
          runId: run.runId,
          symbol,
          step: step.step,
          qty: d2Qty,
          side: d2Side,
          targetLinkType: step.targetLinkType,
          resolvedTargetPrice: linkedTarget.price,
          stoplossPct: step.stepStoplossPct,
        },
      });
    }

    runtime.d2TriggeredSteps = [...triggered].sort((a, b) => a - b);
    runtime.d2StepLastEntries = d2StepLastEntries;
    runtime.d2StepsState = d2States;
    await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("error", "tpl_poller_run_tick_failed", {
        runId: run.runId,
        strategyId: run.strategyId,
        userId: run.userId,
        error: msg.slice(0, 800),
      });
    }
  }
  console.log(`${LOG} tick complete`);
}
