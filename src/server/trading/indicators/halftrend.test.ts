import { describe, expect, it } from "vitest";

import { calculateHalfTrendSignal, type HalfTrendCandle } from "./halftrend";

function candle(time: number, close: number, span = 1.2): HalfTrendCandle {
  return {
    time,
    open: close - 0.2,
    high: close + span,
    low: close - span,
    close,
    volume: 1000,
  };
}

describe("calculateHalfTrendSignal", () => {
  it("detects downtrend flip after uptrend/consolidation/down move", () => {
    const candles: HalfTrendCandle[] = [];
    let t = 1;
    for (let i = 0; i < 20; i++) candles.push(candle(t++, 100 + i * 1.1));
    for (let i = 0; i < 10; i++) candles.push(candle(t++, 121 + Math.sin(i) * 0.8, 0.9));
    for (let i = 0; i < 20; i++) candles.push(candle(t++, 120 - i * 1.9, 1.5));

    const result = calculateHalfTrendSignal(candles, 3);
    expect(result.flipTo).toBe(1);
    expect(result.flipCandleTime).toBe(33);
    expect(result.trend).toBe(1);
  });

  it("detects uptrend flip after downtrend/consolidation/up move", () => {
    const candles: HalfTrendCandle[] = [];
    let t = 1;
    for (let i = 0; i < 20; i++) candles.push(candle(t++, 200 - i * 1.4));
    for (let i = 0; i < 10; i++) candles.push(candle(t++, 172 + Math.sin(i) * 0.7, 0.9));
    for (let i = 0; i < 20; i++) candles.push(candle(t++, 173 + i * 2.1, 1.6));

    const result = calculateHalfTrendSignal(candles, 3);
    expect(result.flipTo).toBe(0);
    expect(result.flipCandleTime).toBe(33);
    expect(result.trend).toBe(0);
  });
});
