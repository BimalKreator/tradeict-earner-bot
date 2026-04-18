import type { TrendArbExecutionScope } from "./trend-arb-scope";

export type TrendArbAdvancedStrategySettings = {
  symbol: string;
  capitalAllocationPct: number;
  indicatorSettings: {
    amplitude: number;
    channelDeviation: number;
    timeframe: "1m" | "15m" | "1h" | "4h" | "1d";
  };
  delta1: {
    entryQtyPct: number;
    targetProfitPct: number;
    stopLossPct: number;
    /** 0 = disabled. Peak URP % must reach this before entry-level soft stop can fire. */
    d1BreakevenTriggerPct?: number;
  };
  delta2: {
    stepQtyPct: number;
    stepMovePct: number;
    targetProfitPct: number;
    stopLossPct: number;
  };
};

export type TrendArbRuntimeSettings = {
  symbol: string;
  /** Legacy fallback absolute quantity; trend-arb now sizes from capital split + pct. */
  d1EntryQty: string;
  /** Legacy fallback absolute quantity; trend-arb now sizes from capital split + pct. */
  d2StepQty: string;
  d1EntryQtyPct: number;
  d2StepQtyPct: number;
  d2StepMovePct: number;
  d1TargetProfitPct: number;
  d2TargetProfitPct: number;
  d1StopLossPct: number;
  /** 0 = disabled. See `TrendArbStrategyConfig.delta1.d1BreakevenTriggerPct`. */
  d1BreakevenTriggerPct: number;
  d2StopLossPct: number;
  indicatorSettings: {
    amplitude: number;
    channelDeviation: number;
    timeframe: "1m" | "15m" | "1h" | "4h" | "1d";
  };
};

export type TrendArbitrageEnv = {
  enabled: boolean;
  strategyId: string;
  symbol: string;
  baseUrl: string;
  resolution: string;
  lookbackSec: number;
  amplitude: number;
  channelDeviation: number;
  runtime: TrendArbRuntimeSettings;
  executionScope?: TrendArbExecutionScope;
};
