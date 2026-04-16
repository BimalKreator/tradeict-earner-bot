import { ATR, SMA } from "technicalindicators";

/**
 * OHLCV bar for HalfTrend (matches `OhlcvCandle` from rsi-scalper).
 * Logic translated from common open-source HalfTrend Pine (e.g. everget / community ports):
 * `highestbars` / `lowestbars`, `ta.sma(high/low, amplitude)`, `ta.atr(100)/2`, `nz(low[1], low)`.
 */
export type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  time?: number;
};

export type HalfTrendResult = {
  /** 0 = uptrend, 1 = downtrend (Pine `trend`). */
  trend: 0 | 1;
  /** `trend` on the previous bar (Pine `trend[1]`); same as pre-flip when read at bar close. */
  prevTrend: 0 | 1;
  buySignal: boolean;
  sellSignal: boolean;
  /** HalfTrend line: Pine `ht = trend == 0 ? up : down`. */
  htValue: number;
  /** HalfTrend line on the previous closed bar (for scan logging). */
  prevHtValue: number;
};

const ATR_PERIOD = 100;

/** Pine `ta.highestbars(length)`: bars since highest `high` in the window (0 = this bar); tie → most recent bar. */
function highestBarsOffset(highs: number[], i: number, length: number): number {
  const start = Math.max(0, i - length + 1);
  let bestVal = -Infinity;
  let bestIdx = start;
  for (let j = start; j <= i; j++) {
    const v = highs[j]!;
    if (v > bestVal || (v === bestVal && j > bestIdx)) {
      bestVal = v;
      bestIdx = j;
    }
  }
  return i - bestIdx;
}

/** Pine `ta.lowestbars(length)` for `low` series. */
function lowestBarsOffset(lows: number[], i: number, length: number): number {
  const start = Math.max(0, i - length + 1);
  let bestVal = Infinity;
  let bestIdx = start;
  for (let j = start; j <= i; j++) {
    const v = lows[j]!;
    if (v < bestVal || (v === bestVal && j > bestIdx)) {
      bestVal = v;
      bestIdx = j;
    }
  }
  return i - bestIdx;
}

/**
 * HalfTrend indicator — bar-by-bar state machine aligned to Pine execution order.
 *
 * Swing levels and trend flip conditions use **close** prices only (not wick highs/lows),
 * per product requirement; ATR still uses full OHLC for volatility.
 *
 * @param candles ascending time, full OHLC
 * @param amplitude Pine `amplitude` (SMA length + highest/lowest bars window)
 * @param channelDeviation Pine `channelDeviation` (multiplier on `ATR(100)/2`)
 */
export function calculateHalfTrend(
  candles: Candle[],
  amplitude: number = 9,
  channelDeviation: number = 2,
): HalfTrendResult {
  const n = candles.length;
  if (n === 0) {
    return {
      trend: 0,
      prevTrend: 0,
      buySignal: false,
      sellSignal: false,
      htValue: NaN,
      prevHtValue: NaN,
    };
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  const smaHighSeries = SMA.calculate({ period: amplitude, values: highs });
  const smaLowSeries = SMA.calculate({ period: amplitude, values: lows });
  const atrSeries = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: ATR_PERIOD,
  });

  /** Align SMA(amplitude) to bar index `i` (first value at `i === amplitude - 1`). */
  const smaHighAt = (i: number): number => {
    if (i < amplitude - 1) return NaN;
    return smaHighSeries[i - (amplitude - 1)]!;
  };
  const smaLowAt = (i: number): number => {
    if (i < amplitude - 1) return NaN;
    return smaLowSeries[i - (amplitude - 1)]!;
  };

  /** Align library ATR (length `n - ATR_PERIOD`) so bar `i` uses one consolidated ATR value. */
  const atrAt = (i: number): number => {
    if (i < ATR_PERIOD) return NaN;
    return atrSeries[i - ATR_PERIOD]!;
  };

  let trend: 0 | 1 = 0;
  let nextTrend: 0 | 1 = 0;
  let maxLowPrice = closes[0]!;
  let minHighPrice = closes[0]!;
  let up = 0;
  let down = 0;
  /** Pine `up[1]` / `down[1]` — `undefined` means `na`. */
  let prevUp: number | undefined = undefined;
  let prevDown: number | undefined = undefined;

  let lastHt = closes[n - 1]!;
  let lastPrevHt = NaN;
  let lastBuy = false;
  let lastSell = false;
  let lastOpenTrend: 0 | 1 = 0;
  let lastCloseTrend: 0 | 1 = 0;

  for (let i = 0; i < n; i++) {
    const trendPrevBar = trend;

    const close = closes[i]!;

    const hb = highestBarsOffset(closes, i, amplitude);
    const lb = lowestBarsOffset(closes, i, amplitude);
    const highPrice = closes[i - hb]!;
    const lowPrice = closes[i - lb]!;

    const highma = smaHighAt(i);
    const lowma = smaLowAt(i);
    const atr2 = atrAt(i) / 2;
    const _dev = channelDeviation * atr2;

    const prevCloseForFlip =
      i > 0 ? closes[i - 1]! : close;

    if (nextTrend === 1) {
      maxLowPrice = Math.max(lowPrice, maxLowPrice);
      if (
        !Number.isNaN(highma) &&
        highma < maxLowPrice &&
        i > 0 &&
        close < prevCloseForFlip
      ) {
        trend = 1;
        nextTrend = 0;
        minHighPrice = highPrice;
      }
    } else {
      minHighPrice = Math.min(highPrice, minHighPrice);
      if (
        !Number.isNaN(lowma) &&
        lowma > minHighPrice &&
        i > 0 &&
        close > prevCloseForFlip
      ) {
        trend = 0;
        nextTrend = 1;
        maxLowPrice = lowPrice;
      }
    }

    if (trend === 0) {
      if (i > 0 && trendPrevBar !== 0) {
        up = prevDown == null ? down : prevDown;
      } else {
        up = prevUp == null ? maxLowPrice : Math.max(maxLowPrice, prevUp);
      }
    } else {
      if (i > 0 && trendPrevBar !== 1) {
        down = prevUp == null ? up : prevUp;
      } else {
        down = prevDown == null ? minHighPrice : Math.min(minHighPrice, prevDown);
      }
    }

    prevUp = up;
    prevDown = down;

    const ht = trend === 0 ? up : down;
    if (i === n - 2) {
      lastPrevHt = ht;
    }
    lastHt = ht;

    lastOpenTrend = trendPrevBar;
    lastCloseTrend = trend;

    lastBuy = trend === 0 && trendPrevBar === 1;
    lastSell = trend === 1 && trendPrevBar === 0;
  }

  return {
    trend: lastCloseTrend,
    prevTrend: lastOpenTrend,
    buySignal: lastBuy,
    sellSignal: lastSell,
    htValue: lastHt,
    prevHtValue: lastPrevHt,
  };
}
