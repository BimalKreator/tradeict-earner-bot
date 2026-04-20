/**
 * Maps allocated collateral + leverage into a maximum whole contract count using the
 * product's `contract_value` (USD notional per 1 contract from Delta's product API).
 *
 * Delta documents `contract_value` as the notional value of one contract (spot × contract amount).
 * For sizing caps: **approximate** max contracts ≈ floor((collateralUsd × leverage) / contractValueUsd).
 * Callers should still respect venue min size, open interest, and margin models.
 */
export function contractsFromCollateralLeverageAndContractValue(params: {
  collateralUsd: number;
  leverage: number;
  contractValueUsd: number;
}): number {
  const { collateralUsd, leverage, contractValueUsd } = params;
  if (!(collateralUsd > 0) || !(leverage > 0) || !(contractValueUsd > 0)) return 0;
  const maxNotionalUsd = collateralUsd * leverage;
  return Math.floor(maxNotionalUsd / contractValueUsd);
}
