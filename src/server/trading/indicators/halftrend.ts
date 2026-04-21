import { ATR, SMA } from "technicalindicators";

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
};

function windowHigh(candles: HalfTrendCandle[], endIdx: number, len: number): number {
  const start = Math.max(0, endIdx - len + 1);
  let m = -Infinity;
  for (let i = start; i <= endIdx; i++) m = Math.max(m, candles[i]!.high);
  return m;
}

function windowLow(candles: HalfTrendCandle[], endIdx: number, len: number): number {
  const start = Math.max(0, endIdx - len + 1);
  let m = Infinity;
  for (let i = start; i <= endIdx; i++) m = Math.min(m, candles[i]!.low);
  return m;
}

function windowAvg(
  candles: HalfTrendCandle[],
  endIdx: number,
  len: number,
  pick: (c: HalfTrendCandle) => number,
): number {
  const start = Math.max(0, endIdx - len + 1);
  let sum = 0;
  let n = 0;
  for (let i = start; i <= endIdx; i++) {
    sum += pick(candles[i]!);
    n += 1;
  }
  return n > 0 ? sum / n : NaN;
}

export function calculateHalfTrendSignal(
  candles: HalfTrendCandle[],
  amplitude: number,
): HalfTrendEngineResult {
  if (candles.length < 3) {
    return { trend: 0, flipCandleTime: null, flipTo: null };
  }
  const amp = Math.max(1, Math.floor(amplitude));
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  const smaHigh = SMA.calculate({ period: amp, values: highs });
  const smaLow = SMA.calculate({ period: amp, values: lows });
  const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });

  let trend: HalfTrendDirection =
    candles[Math.min(amp, candles.length - 1)]!.close >= candles[0]!.close ? 0 : 1;
  let resistance = windowHigh(candles, Math.min(amp, candles.length - 1), amp);
  let support = windowLow(candles, Math.min(amp, candles.length - 1), amp);
  let lastFlipTs: number | null = null;
  let flipTo: HalfTrendDirection | null = null;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevRecentHigh = windowHigh(candles, i - 1, amp);
    const prevRecentLow = windowLow(candles, i - 1, amp);
    const smaH = i >= amp - 1 ? smaHigh[i - (amp - 1)]! : c.high;
    const smaL = i >= amp - 1 ? smaLow[i - (amp - 1)]! : c.low;
    const avgRecentHighs = windowAvg(candles, i - 1, amp, (x) => x.high);
    const avgRecentLows = windowAvg(candles, i - 1, amp, (x) => x.low);
    const atrV = i >= 14 ? atr[i - 14]! : 0;

    if (trend === 1) {
      resistance = Math.min(resistance, prevRecentHigh);
      const crossUp = avgRecentLows > resistance || smaL > resistance;
      if (crossUp && c.close > prevRecentHigh + atrV * 0.1) {
        trend = 0;
        support = prevRecentLow;
        lastFlipTs = c.time;
        flipTo = 0;
      }
    } else {
      support = Math.max(support, prevRecentLow);
      const crossDown = avgRecentHighs < support || smaH < support;
      if (crossDown && c.close < prevRecentLow - atrV * 0.1) {
        trend = 1;
        resistance = prevRecentHigh;
        lastFlipTs = c.time;
        flipTo = 1;
      }
    }
  }

  return {
    trend,
    flipCandleTime: lastFlipTs,
    flipTo,
  };
}
