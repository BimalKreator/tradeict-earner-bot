import { describe, expect, it } from "vitest";

import {
  computeStackedAccessValidUntil,
  MAX_ACCESS_DAYS_PURCHASED,
  normalizeAccessDaysPurchased,
} from "./subscription-access-stack";

describe("normalizeAccessDaysPurchased", () => {
  it("defaults invalid values to 30", () => {
    expect(normalizeAccessDaysPurchased(undefined)).toBe(30);
    expect(normalizeAccessDaysPurchased(NaN)).toBe(30);
    expect(normalizeAccessDaysPurchased(0)).toBe(30);
    expect(normalizeAccessDaysPurchased(-5)).toBe(30);
  });

  it("caps extreme values", () => {
    expect(normalizeAccessDaysPurchased(999999)).toBe(MAX_ACCESS_DAYS_PURCHASED);
  });
});

describe("computeStackedAccessValidUntil", () => {
  it("renews before expiry: stacks on current end (30d default)", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const currentEnd = new Date("2026-02-15T00:00:00.000Z");
    const next = computeStackedAccessValidUntil(now, currentEnd, 30);
    expect(next.toISOString()).toBe(new Date("2026-03-17T00:00:00.000Z").toISOString());
  });

  it("after expiry: anchor is now, not old end", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const currentEnd = new Date("2026-01-01T00:00:00.000Z");
    const next = computeStackedAccessValidUntil(now, currentEnd, 30);
    expect(next.toISOString()).toBe(new Date("2026-03-31T12:00:00.000Z").toISOString());
  });

  it("first purchase: from now", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const next = computeStackedAccessValidUntil(now, null, 30);
    expect(next.getTime() - now.getTime()).toBe(30 * 86400000);
  });
});
