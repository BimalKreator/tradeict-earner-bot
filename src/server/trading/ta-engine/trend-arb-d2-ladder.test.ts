import { describe, expect, it } from "vitest";

import { parseD2DisplayStepFromCorrelation } from "./trend-arb-d2-ladder";

describe("parseD2DisplayStepFromCorrelation", () => {
  it("reads display step from live-style d2L correlation ids", () => {
    expect(
      parseD2DisplayStepFromCorrelation("ta_trendarb_strat_d2_run-uuid_d2L3_1710000000123"),
    ).toBe(3);
  });

  it("reads display step from virtual-style d2L correlation ids", () => {
    expect(
      parseD2DisplayStepFromCorrelation("ta_trendarb_strat_v_run-uuid_d2L2_1710000000456"),
    ).toBe(2);
  });

  it("maps initial secondary correlation ..._s0 to step 1", () => {
    expect(parseD2DisplayStepFromCorrelation("ta_trendarb_strat_d2_1700000000_s0")).toBe(1);
  });
});
