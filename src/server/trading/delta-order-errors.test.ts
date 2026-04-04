import { describe, expect, it } from "vitest";

import { isInsufficientBalanceOrMarginDeltaError } from "./delta-order-errors";

describe("isInsufficientBalanceOrMarginDeltaError", () => {
  it("matches common margin/balance phrases", () => {
    expect(isInsufficientBalanceOrMarginDeltaError("Insufficient margin")).toBe(true);
    expect(isInsufficientBalanceOrMarginDeltaError("Not enough balance")).toBe(true);
    expect(isInsufficientBalanceOrMarginDeltaError("UNKNOWN_CODE")).toBe(false);
  });

  it("inspects raw JSON blob", () => {
    expect(
      isInsufficientBalanceOrMarginDeltaError("x", {
        error: { message: "undercollateralized" },
      }),
    ).toBe(true);
  });
});
