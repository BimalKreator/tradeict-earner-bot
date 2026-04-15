import type { TrendArbExecutionScope } from "./trend-arb-scope";

export type TrendArbitrageEnv = {
  enabled: boolean;
  strategyId: string;
  symbol: string;
  baseUrl: string;
  resolution: string;
  lookbackSec: number;
  amplitude: number;
  channelDeviation: number;
  executionScope?: TrendArbExecutionScope;
};
