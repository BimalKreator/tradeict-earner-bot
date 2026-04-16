import { describe, expect, it } from "vitest";

import { calculateHalfTrend, type Candle } from "./halftrend";

function makeSeries(n: number, closeAt: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = closeAt(i);
    const w = 0.5;
    return { open: c, high: c + w, low: c - w, close: c, time: i };
  });
}

describe("calculateHalfTrend", () => {
  it("returns a structured result for sufficient history", () => {
    const candles = makeSeries(160, (i) => 100 + Math.sin(i / 12) * 2);
    const r = calculateHalfTrend(candles, 9, 2);
    expect(r.trend === 0 || r.trend === 1).toBe(true);
    expect(r.prevTrend === 0 || r.prevTrend === 1).toBe(true);
    expect(typeof r.buySignal).toBe("boolean");
    expect(typeof r.sellSignal).toBe("boolean");
    expect(typeof r.htValue).toBe("number");
    expect(typeof r.prevHtValue).toBe("number");
  });

  it("returns neutral object for empty input", () => {
    const r = calculateHalfTrend([], 9, 2);
    expect(r.buySignal).toBe(false);
    expect(r.sellSignal).toBe(false);
    expect(Number.isNaN(r.prevHtValue)).toBe(true);
  });
});
