import { describe, expect, it } from "vitest";

import { normalizeDeltaOrderContractSize } from "./delta-order-contract-size";

describe("normalizeDeltaOrderContractSize", () => {
  it("floors fractional quantities to whole contracts", () => {
    expect(normalizeDeltaOrderContractSize("3.9")).toEqual({ ok: true, size: 3 });
    expect(normalizeDeltaOrderContractSize("2.001")).toEqual({ ok: true, size: 2 });
  });

  it("accepts integer strings", () => {
    expect(normalizeDeltaOrderContractSize("5")).toEqual({ ok: true, size: 5 });
  });

  it("rejects zero and non-finite", () => {
    expect(normalizeDeltaOrderContractSize("0").ok).toBe(false);
    expect(normalizeDeltaOrderContractSize("0.4").ok).toBe(false);
    expect(normalizeDeltaOrderContractSize("").ok).toBe(false);
  });
});
