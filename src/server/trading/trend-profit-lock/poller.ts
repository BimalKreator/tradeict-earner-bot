import { and, eq, isNull } from "drizzle-orm";

import { resolveTrendProfitLockConfigForUi } from "@/lib/trend-profit-lock-form";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
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
import { resolveFinalAllocatedCapitalUsd } from "@/server/trading/execution-preferences";
import { calculateHalfTrendSignal, type HalfTrendCandle } from "@/server/trading/indicators/halftrend";
import { resolveExchangeTradingAdapter } from "@/server/trading/adapters/resolve-exchange-adapter";
import { dispatchStrategyExecutionSignal } from "@/server/trading/strategy-signal-dispatcher";
import {
  ensureHedgeScalpingLiveFeed,
  getHedgeScalpingLiveSnapshot,
} from "@/server/trading/ta-engine/hedge-scalping-live-feed";
import {
  computeChartLookbackSeconds,
  filterClosedCandles,
  resolutionToSeconds,
  TA_CHART_TARGET_CLOSED_BARS,
} from "@/server/trading/ta-engine/rsi-scalper";
import { tradingLog } from "@/server/trading/trading-log";

const LOG = "[TPL-POLLER]";
const DELTA_BASE_URL = process.env.HS_WORKER_DELTA_BASE_URL?.trim() || "https://api.india.delta.exchange";

type TplRuntimeState = {
  lastFlipCandleTime?: number;
  lastCompletedD1FlipDirection?: "LONG" | "SHORT";
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
  };
  d2TriggeredSteps?: number[];
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
      status: "open" | "closed";
      closeReason?: "target" | "stoploss" | "unknown";
      closedAt?: string;
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

function favorableDistancePct(entry: number, mark: number, side: "LONG" | "SHORT"): number {
  if (!(entry > 0) || !(mark > 0)) return 0;
  if (side === "LONG") return ((mark - entry) / entry) * 100;
  return ((entry - mark) / entry) * 100;
}

async function resolveLiveMark(symbol: string, fallback: number | null): Promise<number | null> {
  const mark = await fetchDeltaIndiaTickerMarkPrice({ symbol });
  if (mark != null && Number.isFinite(mark) && mark > 0) return mark;
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

async function persistRuntime(
  runId: string,
  parsedRun: Record<string, unknown>,
  runtime: TplRuntimeState,
): Promise<void> {
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
}

async function tryRecordExecutionLogByCorrelation(params: {
  correlationId: string;
  runId: string;
  exchangeConnectionId: string | null | undefined;
  message: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!params.exchangeConnectionId) return;
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
    if (!snapshot || snapshot.candles.length < 40) continue;

    const closed = filterClosedCandles(snapshot.candles, resSec);
    if (closed.length < 30) continue;
    const candles: HalfTrendCandle[] = closed.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const ht = calculateHalfTrendSignal(candles, cfg.halftrendAmplitude);
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

    if (!hasOpenD1 && runtime.d1) {
      if (d2NetQtyAbs > 1e-8 && run.secondaryExchangeConnectionId) {
        const flattenCorrelationId = `tpl_d2_flatten_${run.runId}_${Date.now()}`;
        const flattenSide = d2Net > 0 ? "sell" : "buy";
        const flattenQty = Math.max(1, Math.floor(d2NetQtyAbs));
        const flattenDispatch = await dispatchStrategyExecutionSignal({
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
      }
      runtime.lastCompletedD1FlipDirection = runtime.d1.side;
      runtime.d1 = undefined;
      runtime.d2TriggeredSteps = [];
      runtime.d2StepsState = {};
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
    }

    if (
      ht.flipTo != null &&
      ht.flipCandleTime != null &&
      ht.flipCandleTime !== runtime.lastFlipCandleTime &&
      sideFromFlip(ht.flipTo) !== runtime.lastCompletedD1FlipDirection &&
      !hasOpenD1
    ) {
      if (!run.primaryExchangeConnectionId) {
        tradingLog("warn", "tpl_d1_missing_primary_exchange", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
        });
      } else {
        const capitalUsd = resolveFinalAllocatedCapitalUsd({
          runSettingsJson: run.runSettingsJson,
          columnCapital: run.capitalToUseInr,
          recommendedCapitalInr: run.recommendedCapitalInr,
        });
        const rawCv = await fetchDeltaIndiaProductContractValue(symbol);
        const contractValueUsd = normalizeUsdContractValue(rawCv, mark);
        const allocUsd = Math.max(0, (capitalUsd ?? 0) * (cfg.d1CapitalAllocationPct / 100));
        const minContracts = await fetchDeltaIndiaProductMinOrderContracts(symbol);
        const qty = Math.max(minContracts ?? 1, Math.floor(allocUsd / Math.max(contractValueUsd, 1e-9)));
        if (qty > 0) {
          const d1Side = sideFromFlip(ht.flipTo);
          const correlationId = `tpl_d1_${run.runId}_${ht.flipCandleTime}_${d1Side.toLowerCase()}`;
          const dispatch = await dispatchStrategyExecutionSignal({
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
              halftrend_flip_time: ht.flipCandleTime,
            },
          });
          tradingLog(dispatch.ok ? "info" : "warn", "tpl_d1_entry_dispatch", {
            runId: run.runId,
            strategyId: run.strategyId,
            userId: run.userId,
            symbol,
            qty,
            side: d1Side,
            mark,
            ok: dispatch.ok,
            jobsEnqueued: dispatch.ok ? dispatch.liveJobsEnqueued : 0,
            error: dispatch.ok ? null : dispatch.error,
          });
          runtime.d1 = {
            side: d1Side,
            entryPrice: mark,
            targetPrice: targetPrice(mark, d1Side, cfg.d1TargetPct),
            stoplossPrice: stoplossPrice(mark, d1Side, cfg.d1StoplossPct),
            breakevenTriggerPct: cfg.d1BreakevenTriggerPct,
          };
        }
      }
      runtime.lastFlipCandleTime = ht.flipCandleTime;
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
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
        const stopPlace = await adapterRes.adapter.placeReduceOnlyStopLoss({
          internalClientOrderId: stopClientId,
          symbol,
          side: stopSide,
          quantity: fmtQty(Math.max(1, Math.floor(Math.abs(netQty)))),
          stopPrice: String(d1StopPx),
        });
        if (stopPlace.ok) {
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

    const movedPct = favorableDistancePct(entryPx, mark, d1Side);
    if (movedPct >= cfg.d1BreakevenTriggerPct && !runtime.d1?.breakevenExecutedAt) {
      const existingStopId = runtime.d1?.stopLossOrderExternalId ?? null;
      const adapterRes = await resolveRunExchangeAdapter(run.primaryExchangeConnectionId);
      const amendAttempted = Boolean(existingStopId) && adapterRes.ok && Boolean(adapterRes.adapter.amendStopLossOrder);
      let amendOk = false;
      let amendError: string | null = null;
      let amendedStopOrderId: string | null = null;
      if (amendAttempted) {
        const amend = await adapterRes.adapter.amendStopLossOrder!({
          existingExternalOrderId: existingStopId!,
          replacementInternalClientOrderId: generateInternalClientOrderId(),
          symbol,
          side: d1Side === "LONG" ? "sell" : "buy",
          quantity: fmtQty(Math.max(1, Math.floor(Math.abs(netQty)))),
          newStopPrice: String(entryPx),
        });
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
        movedPct,
        newStopPrice: entryPx,
        existingStopOrderId: existingStopId,
        amendedStopOrderId,
        ok: amendOk,
        error: amendError,
      });
      runtime.d1 = {
        side: d1Side,
        entryPrice: entryPx,
        targetPrice: d1TargetPx,
        stoplossPrice: entryPx,
        breakevenTriggerPct: cfg.d1BreakevenTriggerPct,
        breakevenQueuedAt: new Date().toISOString(),
        breakevenExecutedAt: amendOk ? new Date().toISOString() : undefined,
        breakevenOrderCorrelationId: runtime.d1?.breakevenOrderCorrelationId,
        stopLossOrderExternalId: amendedStopOrderId ?? runtime.d1?.stopLossOrderExternalId,
        stopLossOrderClientId: runtime.d1?.stopLossOrderClientId,
        stopLossPlacedAt: runtime.d1?.stopLossPlacedAt,
      };
      await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
      if (amendOk) {
        tradingLog("info", "tpl_d1_breakeven_stop_amended", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          movedPct,
          triggerPct: cfg.d1BreakevenTriggerPct,
          oldStopOrderId: existingStopId,
          newStopOrderId: amendedStopOrderId,
        });
      }
    }

    const d2States = runtime.d2StepsState ?? {};
    const d2OpenQtyTracked = Object.values(d2States)
      .filter((s) => s.status === "open")
      .reduce((sum, s) => sum + s.qty, 0);
    for (const state of Object.values(d2States)) {
      if (state.status !== "open") continue;
      const hitTarget = state.side === "LONG" ? mark >= state.targetPrice : mark <= state.targetPrice;
      const hitStop = state.side === "LONG" ? mark <= state.stoplossPrice : mark >= state.stoplossPrice;
      if (!hitTarget && !hitStop) continue;
      const expectedOpenWithoutStep = Math.max(0, d2OpenQtyTracked - state.qty);
      if (d2NetQtyAbs > expectedOpenWithoutStep + 1e-8) continue;
      state.status = "closed";
      state.closeReason = hitTarget ? "target" : "stoploss";
      state.closedAt = new Date().toISOString();
      if (hitTarget) {
        delete d2States[String(state.step)];
        tradingLog("info", "tpl_d2_step_reentry_reset_ready", {
          runId: run.runId,
          strategyId: run.strategyId,
          userId: run.userId,
          symbol,
          step: state.step,
        });
      }
    }

    const triggered = new Set(runtime.d2TriggeredSteps ?? []);
    for (const step of cfg.d2Steps) {
      const existingState = d2States[String(step.step)];
      if (triggered.has(step.step) || existingState?.status === "open") continue;
      // D2 trigger is % of the D1 target journey, not a flat % move from entry.
      const d1TargetDistance = Math.abs(d1TargetPx - entryPx);
      const stepJourneyDistance = d1TargetDistance * (step.stepTriggerPct / 100);
      const triggerPx = d1Side === "LONG" ? entryPx + stepJourneyDistance : entryPx - stepJourneyDistance;
      const reached = d1Side === "LONG" ? mark >= triggerPx : mark <= triggerPx;
      if (!reached) continue;

      const d1QtyInt = Math.max(0, Math.floor(Math.abs(netQty)));
      const minContracts = await fetchDeltaIndiaProductMinOrderContracts(symbol);
      const d2Qty = Math.max(minContracts ?? 1, Math.floor(d1QtyInt * (step.stepQtyPctOfD1 / 100)));
      const d2Side = oppositeSide(d1Side);
      const correlationId = `tpl_d2_step_${step.step}_${run.runId}_${Date.now()}`;
      const d2Dispatch = await dispatchStrategyExecutionSignal({
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
          step_target_pct: step.stepTargetPct,
          step_stoploss_pct: step.stepStoplossPct,
        },
      });
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
        dispatchOk: d2Dispatch.ok,
        liveJobsEnqueued: d2Dispatch.ok ? d2Dispatch.liveJobsEnqueued : 0,
        dispatchError: d2Dispatch.ok ? null : d2Dispatch.error,
      });
      if (!d2Dispatch.ok) continue;
      d2States[String(step.step)] = {
        step: step.step,
        triggerPrice: triggerPx,
        entryMarkPrice: mark,
        side: d2Side,
        qty: d2Qty,
        targetPrice: targetPrice(mark, d2Side, step.stepTargetPct),
        stoplossPrice: stoplossPrice(mark, d2Side, step.stepStoplossPct),
        executedAt: new Date().toISOString(),
        correlationId,
        status: "open",
      };
      triggered.add(step.step);
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
          targetPct: step.stepTargetPct,
          stoplossPct: step.stepStoplossPct,
        },
      });
    }

    runtime.d2TriggeredSteps = [...triggered].sort((a, b) => a - b);
    runtime.d2StepsState = d2States;
    await persistRuntime(run.runId, parsedRun as Record<string, unknown>, runtime);
  }
  console.log(`${LOG} tick complete`);
}
