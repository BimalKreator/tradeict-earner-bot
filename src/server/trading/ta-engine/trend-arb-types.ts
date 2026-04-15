import type { TrendArbExecutionScope } from "./trend-arb-scope";

export type TrendArbAdvancedStrategySettings = {
  symbol: string;
  capitalAllocationPct: number;
  indicatorSettings: Record<string, number>;
  delta1: {
    entryQtyPct: number;
    targetProfitPct: number;
    stopLossPct: number;
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
  d1EntryQty: string;
  d2StepQty: string;
  d2StepMovePct: number;
  d1TargetProfitPct: number;
  d2TargetProfitPct: number;
  d1StopLossPct: number;
  d2StopLossPct: number;
  indicatorAmplitude: number;
  indicatorChannelDeviation: number;
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
