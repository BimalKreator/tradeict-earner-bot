import { calculateHalfTrend } from "@/server/trading/ta-engine/indicators/halftrend";

export type HalfTrendCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time: number;
};

export type HalfTrendDirection = 0 | 1;

export type HalfTrendEngineResult = {
  trend: HalfTrendDirection;
  flipCandleTime: number | null;
  flipTo: HalfTrendDirection | null;
  atr?: number;
  highPrice?: number;
  lowPrice?: number;
  up?: number;
  down?: number;
};

export function calculateHalfTrendSignal(
  candles: HalfTrendCandle[],
  amplitude: number,
): HalfTrendEngineResult {
  if (candles.length < 3) {
    return { trend: 0, flipCandleTime: null, flipTo: null };
  }
  const base = calculateHalfTrend(
    candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      time: c.time,
    })),
    amplitude,
  );
  const flipTo: HalfTrendDirection | null =
    base.buySignal ? 0 : base.sellSignal ? 1 : null;
  const flipCandleTime =
    flipTo != null ? candles[candles.length - 1]?.time ?? null : null;
  return {
    trend: base.trend,
    flipTo,
    flipCandleTime,
    atr: base.atr,
    highPrice: base.highPrice,
    lowPrice: base.lowPrice,
    up: base.up,
    down: base.down,
  };
}
