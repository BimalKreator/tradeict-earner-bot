import { describe, expect, it } from "vitest";

import { toMoneyString, weeklyAmountDue } from "./revenue-share-math";

describe("weeklyAmountDue", () => {
  it("is zero when profit is non-positive", () => {
    expect(weeklyAmountDue(0, "20")).toBe("0.00");
    expect(weeklyAmountDue(-100, "20")).toBe("0.00");
  });

  it("is zero when percent is invalid", () => {
    expect(weeklyAmountDue(1000, "0")).toBe("0.00");
    expect(weeklyAmountDue(1000, "not-a-number")).toBe("0.00");
  });

  it("computes share of weekly net profit", () => {
    expect(weeklyAmountDue(10000, "15")).toBe("1500.00");
    expect(weeklyAmountDue(333.33, "10")).toBe("33.33");
  });
});

describe("toMoneyString", () => {
  it("handles non-finite", () => {
    expect(toMoneyString(NaN)).toBe("0.00");
    expect(toMoneyString(Infinity)).toBe("0.00");
  });
});
