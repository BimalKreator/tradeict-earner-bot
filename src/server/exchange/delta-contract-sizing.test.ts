import { describe, expect, it } from "vitest";

import { contractsFromCollateralLeverageAndContractValue } from "./delta-contract-sizing";

describe("contractsFromCollateralLeverageAndContractValue", () => {
  it("uses contract_value as USD notional per contract", () => {
    // e.g. $100 collateral, 10x → $1000 notional; $50 per contract → 20 contracts
    expect(
      contractsFromCollateralLeverageAndContractValue({
        collateralUsd: 100,
        leverage: 10,
        contractValueUsd: 50,
      }),
    ).toBe(20);
  });

  it("floors partial contracts", () => {
    expect(
      contractsFromCollateralLeverageAndContractValue({
        collateralUsd: 100,
        leverage: 10,
        contractValueUsd: 33,
      }),
    ).toBe(30);
  });

  it("returns 0 for invalid inputs", () => {
    expect(
      contractsFromCollateralLeverageAndContractValue({
        collateralUsd: 0,
        leverage: 10,
        contractValueUsd: 1,
      }),
    ).toBe(0);
  });
});
