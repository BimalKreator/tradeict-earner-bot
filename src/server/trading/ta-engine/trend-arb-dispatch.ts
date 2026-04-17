import { dispatchStrategyExecutionSignal } from "../strategy-signal-dispatcher";
import type { StrategySignalIntakeResponse } from "../signals/types";

import {
  TREND_ARB_D1_SL_PCT,
  TREND_ARB_D1_TP_PCT,
  TREND_ARB_D1_TRAIL_BE_AT_PCT,
  TREND_ARB_D2_TP_PCT,
  TREND_ARB_PRIMARY_QTY,
  TREND_ARB_SECONDARY_CLIP_QTY,
} from "./trend-arb-constants";

export type TrendArbSide = "long" | "short";

function oppositeSide(side: TrendArbSide): "buy" | "sell" {
  return side === "long" ? "sell" : "buy";
}

function entrySide(side: TrendArbSide): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}

export function trendArbPrimaryCorrelationId(
  strategyId: string,
  candleTime: number,
  side: TrendArbSide,
): string {
  return `ta_trendarb_${strategyId}_d1_${candleTime}_${side}`;
}

export function trendArbSecondaryCorrelationId(
  strategyId: string,
  candleTime: number,
  stepIndex: number,
): string {
  return `ta_trendarb_${strategyId}_d2_${candleTime}_s${stepIndex}`;
}

type DispatchScope = {
  targetUserIds?: string[];
  targetRunIds?: string[];
};

export async function dispatchTrendArbPrimaryEntry(
  params: {
    strategyId: string;
    symbol: string;
    quantity?: string;
    entryQtyPct?: number;
    stopLossPct?: number;
    targetProfitPct?: number;
    side: TrendArbSide;
    candleTime: number;
    markPrice: number;
  } & DispatchScope,
): Promise<StrategySignalIntakeResponse> {
  const qty = params.quantity ?? TREND_ARB_PRIMARY_QTY;
  const correlationId = trendArbPrimaryCorrelationId(
    params.strategyId,
    params.candleTime,
    params.side,
  );
  return dispatchStrategyExecutionSignal({
    strategyId: params.strategyId,
    correlationId,
    symbol: params.symbol,
    side: entrySide(params.side),
    orderType: "market",
    quantity: qty,
    actionType: "entry",
    exchangeVenue: "primary",
    targetUserIds: params.targetUserIds,
    targetRunIds: params.targetRunIds,
    metadata: {
      source: "ta_trend_arbitrage",
      leg: "delta1_entry",
      mark_price: params.markPrice,
      half_trend: true,
      /** Resolves per-run qty from virtual/live capital (see `computeTrendArbSizedQuantity`). */
      trend_arb_sizing: {
        mode: "capital_split_50_50",
        leg: "d1_entry",
        qtyPct: params.entryQtyPct ?? 100,
      },
      risk: {
        sl_pct: params.stopLossPct ?? TREND_ARB_D1_SL_PCT,
        tp_pct: params.targetProfitPct ?? TREND_ARB_D1_TP_PCT,
        trail_sl_to_be_at_pct: TREND_ARB_D1_TRAIL_BE_AT_PCT,
      },
    },
  });
}

export async function dispatchTrendArbSecondaryHedgeClip(
  params: {
    strategyId: string;
    symbol: string;
    candleTime: number;
    stepIndex: number;
    side: TrendArbSide;
    forceSide?: TrendArbSide;
    d1Side?: TrendArbSide;
    markPrice: number;
    quantity?: string;
    stepQtyPct?: number;
    targetProfitPct?: number;
    correlationIdOverride?: string;
    /**
     * Initial hedge (step 0): size from virtual/live capital via `capital_split_50_50`.
     * D2 clip contracts = (D1-sized qty at same capital & mark using this %) × (stepQtyPct/100).
     * Follow-up steps from `trend-arb-poll`: keep false so `quantity` (from actual D1 size) is used.
     */
    applyCapitalSplitSizing?: boolean;
    /** Basis for initial D2 clip sizing: admin D1 entry % (half-capital leg). Default 100. */
    d1ClipQtyPct?: number;
    /** User-facing ladder step (1 = initial hedge at flip, 2–10 = rungs). */
    d2DisplayStep?: number;
    d2StepLabel?: string;
  } & DispatchScope,
): Promise<StrategySignalIntakeResponse> {
  const correlationId =
    params.correlationIdOverride ??
    trendArbSecondaryCorrelationId(params.strategyId, params.candleTime, params.stepIndex);
  const effectiveSide = params.forceSide ?? params.side;
  const useCapitalSplit = params.applyCapitalSplitSizing === true;
  return dispatchStrategyExecutionSignal({
    strategyId: params.strategyId,
    correlationId,
    symbol: params.symbol,
    side: entrySide(effectiveSide),
    orderType: "market",
    quantity: params.quantity ?? TREND_ARB_SECONDARY_CLIP_QTY,
    actionType: "entry",
    exchangeVenue: "secondary",
    targetUserIds: params.targetUserIds,
    targetRunIds: params.targetRunIds,
    metadata: {
      source: "ta_trend_arbitrage",
      leg: "delta2_hedge_clip",
      hedge_step: params.d2DisplayStep ?? params.stepIndex,
      d2_display_step: (() => {
        const s =
          params.d2DisplayStep ?? (params.stepIndex <= 0 ? 1 : params.stepIndex + 1);
        return s;
      })(),
      d2_step_label: (() => {
        const s =
          params.d2DisplayStep ?? (params.stepIndex <= 0 ? 1 : params.stepIndex + 1);
        return params.d2StepLabel ?? `D2 Step ${s}`;
      })(),
      mark_price: params.markPrice,
      trend_arb_sizing: useCapitalSplit
        ? {
            mode: "capital_split_50_50",
            leg: "d2_step",
            qtyPct: params.stepQtyPct ?? 10,
            d1_clip_qty_pct: params.d1ClipQtyPct ?? 100,
          }
        : {
            mode: "absolute",
            leg: "d2_step",
          },
      force_side: effectiveSide,
      risk: { tp_pct: params.targetProfitPct ?? TREND_ARB_D2_TP_PCT },
    },
  });
}

/** Reduce-only close for one Delta 2 ladder clip (per-step TP). */
export async function dispatchTrendArbCloseSecondaryClip(params: {
  strategyId: string;
  symbol: string;
  markPrice: number;
  /** Close short clips with `buy`, long clips with `sell`. */
  flattenSide: "buy" | "sell";
  quantity: string;
  closesEntryCorrelationId: string;
  d2DisplayStep: number;
  correlationNonce: string;
  correlationIdOverride?: string;
} & DispatchScope): Promise<StrategySignalIntakeResponse> {
  const correlationId =
    params.correlationIdOverride ??
    `ta_trendarb_${params.strategyId}_d2X${params.d2DisplayStep}_${params.correlationNonce}`;
  return dispatchStrategyExecutionSignal({
    strategyId: params.strategyId,
    correlationId,
    symbol: params.symbol,
    side: params.flattenSide,
    orderType: "market",
    quantity: params.quantity,
    actionType: "exit",
    exchangeVenue: "secondary",
    targetUserIds: params.targetUserIds,
    targetRunIds: params.targetRunIds,
    metadata: {
      source: "ta_trend_arbitrage",
      leg: "delta2_clip_exit",
      mark_price: params.markPrice,
      closes_entry_correlation_id: params.closesEntryCorrelationId,
      d2_display_step: params.d2DisplayStep,
      d2_step_label: `D2 Step ${params.d2DisplayStep} exit`,
    },
  });
}

export async function dispatchTrendArbFlattenSecondary(
  params: {
    strategyId: string;
    symbol: string;
    reason: string;
    nonce: string;
    markPrice: number;
    /** Close short clips with `buy`, long clips with `sell`. */
    flattenSide: "buy" | "sell";
    /** Total contracts to close (sum of hedge clips). */
    quantity: string;
  } & DispatchScope,
): Promise<StrategySignalIntakeResponse> {
  const correlationId = `ta_trendarb_${params.strategyId}_d2_flat_${params.nonce}`;
  return dispatchStrategyExecutionSignal({
    strategyId: params.strategyId,
    correlationId,
    symbol: params.symbol,
    side: params.flattenSide,
    orderType: "market",
    quantity: params.quantity,
    actionType: "exit",
    exchangeVenue: "secondary",
    targetUserIds: params.targetUserIds,
    targetRunIds: params.targetRunIds,
    metadata: {
      source: "ta_trend_arbitrage",
      leg: "delta2_flatten_all",
      reason: params.reason,
      mark_price: params.markPrice,
    },
  });
}

/** Reduce-only market close for Delta 1 (primary venue). */
export async function dispatchTrendArbClosePrimary(
  params: {
    strategyId: string;
    symbol: string;
    quantity: string;
    side: "buy" | "sell";
    markPrice: number;
    correlationNonce: string;
    metadataReason: string;
  } & DispatchScope,
): Promise<StrategySignalIntakeResponse> {
  const correlationId = `ta_trendarb_${params.strategyId}_d1_exit_${params.correlationNonce}`;
  return dispatchStrategyExecutionSignal({
    strategyId: params.strategyId,
    correlationId,
    symbol: params.symbol,
    side: params.side,
    orderType: "market",
    quantity: params.quantity,
    actionType: "exit",
    exchangeVenue: "primary",
    targetUserIds: params.targetUserIds,
    targetRunIds: params.targetRunIds,
    metadata: {
      source: "ta_trend_arbitrage",
      leg: "delta1_flatten",
      reason: params.metadataReason,
      mark_price: params.markPrice,
    },
  });
}
