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

type DispatchScope = {
  targetUserIds?: string[];
  targetRunIds?: string[];
};

export async function dispatchTrendArbPrimaryEntry(
  params: {
    strategyId: string;
    symbol: string;
    quantity?: string;
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
      risk: {
        sl_pct: TREND_ARB_D1_SL_PCT,
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
    d1Side: TrendArbSide;
    markPrice: number;
    quantity?: string;
    targetProfitPct?: number;
    correlationIdOverride?: string;
  } & DispatchScope,
): Promise<StrategySignalIntakeResponse> {
  const correlationId =
    params.correlationIdOverride ??
    `ta_trendarb_${params.strategyId}_d2_${params.candleTime}_s${params.stepIndex}`;
  return dispatchStrategyExecutionSignal({
    strategyId: params.strategyId,
    correlationId,
    symbol: params.symbol,
    side: oppositeSide(params.d1Side),
    orderType: "market",
    quantity: params.quantity ?? TREND_ARB_SECONDARY_CLIP_QTY,
    actionType: "entry",
    exchangeVenue: "secondary",
    targetUserIds: params.targetUserIds,
    targetRunIds: params.targetRunIds,
    metadata: {
      source: "ta_trend_arbitrage",
      leg: "delta2_hedge_clip",
      hedge_step: params.stepIndex,
      mark_price: params.markPrice,
      risk: { tp_pct: params.targetProfitPct ?? TREND_ARB_D2_TP_PCT },
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
