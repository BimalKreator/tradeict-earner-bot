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
  /** Internal guard state for down-flip checks. */
  maxLowPrice: number;
  /** Internal guard state for up-flip checks. */
  minHighPrice: number;
};

const ATR_PERIOD = 100;
const HALF_TREND_AMPLITUDE = 2;

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
 * TradingView parity mode:
 * - swing levels (`highPrice` / `lowPrice`) are derived from highest `high` / lowest `low` windows
 * - flip guards use previous-bar wick references (`low[1]` / `high[1]`) rather than close-only checks
 * - SMA(high) / SMA(low) and ATR use standard OHLC inputs
 * **Signals** (`buySignal` / `sellSignal`) are emitted on trend state changes driven by that state machine.
 *
 * @param candles ascending time, full OHLC
 * @param amplitude Pine `amplitude` (SMA length + highest/lowest bars window)
 * @param channelDeviation Pine `channelDeviation` (multiplier on `ATR(100)/2`)
 */
export function calculateHalfTrend(
  candles: Candle[],
  amplitude: number = 2,
  channelDeviation: number = 2,
  options?: { treatLastCandleAsForming?: boolean },
): HalfTrendResult {
  // Hard-locked for TradingView parity requested by strategy runtime.
  void amplitude;
  const effectiveAmplitude = HALF_TREND_AMPLITUDE;
  const n = candles.length;
  if (n === 0) {
    return {
      trend: 0,
      prevTrend: 0,
      buySignal: false,
      sellSignal: false,
      htValue: NaN,
      prevHtValue: NaN,
      maxLowPrice: NaN,
      minHighPrice: NaN,
    };
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  const smaHighSeries = SMA.calculate({ period: effectiveAmplitude, values: highs });
  const smaLowSeries = SMA.calculate({ period: effectiveAmplitude, values: lows });
  const atrSeries = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: ATR_PERIOD,
  });

  /** Align SMA(amplitude) to bar index `i` (first value at `i === amplitude - 1`). */
  const smaHighAt = (i: number): number => {
    if (i < effectiveAmplitude - 1) return NaN;
    return smaHighSeries[i - (effectiveAmplitude - 1)]!;
  };
  const smaLowAt = (i: number): number => {
    if (i < effectiveAmplitude - 1) return NaN;
    return smaLowSeries[i - (effectiveAmplitude - 1)]!;
  };

  /** Align library ATR (length `n - ATR_PERIOD`) so bar `i` uses one consolidated ATR value. */
  const atrAt = (i: number): number => {
    if (i < ATR_PERIOD) return NaN;
    return atrSeries[i - ATR_PERIOD]!;
  };

  let trend: 0 | 1 = 0;
  let nextTrend: 0 | 1 = 0;
  let maxLowPrice = lows[1] ?? lows[0]!;
  let minHighPrice = highs[1] ?? highs[0]!;
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
  const treatLastCandleAsForming = Boolean(options?.treatLastCandleAsForming && n > 1);
  const loopEndExclusive = treatLastCandleAsForming ? n - 1 : n;

  for (let i = 0; i < loopEndExclusive; i++) {
    const trendPrevBar = trend;

    const close = closes[i]!;

    const hb = highestBarsOffset(highs, i, effectiveAmplitude);
    const lb = lowestBarsOffset(lows, i, effectiveAmplitude);
    const highPrice = highs[i - hb]!;
    const lowPrice = lows[i - lb]!;

    const highma = smaHighAt(i);
    const lowma = smaLowAt(i);
    const atr2 = atrAt(i) / 2;
    const _dev = channelDeviation * atr2;

    // Pine parity: nz(low[1], low) / nz(high[1], high)
    const prevLowForFlip = i > 0 ? lows[i - 1]! : lows[i]!;
    const prevHighForFlip = i > 0 ? highs[i - 1]! : highs[i]!;

    if (nextTrend === 1) {
      maxLowPrice = Math.max(lowPrice, maxLowPrice);
      if (
        !Number.isNaN(highma) &&
        highma < maxLowPrice &&
        close < prevLowForFlip
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
        close > prevHighForFlip
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

  if (treatLastCandleAsForming) {
    const i = n - 1;
    const close = closes[i]!;
    const hb = highestBarsOffset(highs, i, effectiveAmplitude);
    const lb = lowestBarsOffset(lows, i, effectiveAmplitude);
    const highPrice = highs[i - hb]!;
    const lowPrice = lows[i - lb]!;
    const highma = smaHighAt(i);
    const lowma = smaLowAt(i);
    const atr2 = atrAt(i) / 2;
    const _dev = channelDeviation * atr2;
    const prevLowForFlip = i > 0 ? lows[i - 1]! : lows[i]!;
    const prevHighForFlip = i > 0 ? highs[i - 1]! : highs[i]!;

    // Non-mutating provisional pass for forming candle:
    // - evaluate potential current-trend/line with frozen state from last closed candle
    // - do not emit buy/sell signals from this pass
    let pTrend: 0 | 1 = trend;
    let pNextTrend: 0 | 1 = nextTrend;
    let pMaxLowPrice = maxLowPrice;
    let pMinHighPrice = minHighPrice;
    let pUp = up;
    let pDown = down;
    const pPrevUp = prevUp;
    const pPrevDown = prevDown;

    if (pNextTrend === 1) {
      pMaxLowPrice = Math.max(lowPrice, pMaxLowPrice);
      if (!Number.isNaN(highma) && highma < pMaxLowPrice && close < prevLowForFlip) {
        pTrend = 1;
        pNextTrend = 0;
        pMinHighPrice = highPrice;
      }
    } else {
      pMinHighPrice = Math.min(highPrice, pMinHighPrice);
      if (!Number.isNaN(lowma) && lowma > pMinHighPrice && close > prevHighForFlip) {
        pTrend = 0;
        pNextTrend = 1;
        pMaxLowPrice = lowPrice;
      }
    }

    if (pTrend === 0) {
      if (pTrend !== trend) {
        pUp = pPrevDown == null ? pDown : pPrevDown;
      } else {
        pUp = pPrevUp == null ? pMaxLowPrice : Math.max(pMaxLowPrice, pPrevUp);
      }
    } else {
      if (pTrend !== trend) {
        pDown = pPrevUp == null ? pUp : pPrevUp;
      } else {
        pDown = pPrevDown == null ? pMinHighPrice : Math.min(pMinHighPrice, pPrevDown);
      }
    }

    const pHt = pTrend === 0 ? pUp : pDown;
    lastPrevHt = trend === 0 ? up : down;
    lastHt = pHt;
    // Keep signal-driving trend state pinned to the last *closed* candle.
    // The forming-candle provisional pass is only for live HT line visualization.
    // Preserve closed-candle crossover state from the main loop.
  }

  return {
    trend: lastCloseTrend,
    prevTrend: lastOpenTrend,
    buySignal: lastBuy,
    sellSignal: lastSell,
    htValue: lastHt,
    prevHtValue: lastPrevHt,
    maxLowPrice,
    minHighPrice,
  };
}
