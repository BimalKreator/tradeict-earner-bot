/**
 * Merge strategy defaults with an optional time-effective pricing override row.
 * If only one override column is set, the other uses the strategy default.
 */
export type StrategyDefaultPricing = {
  defaultMonthlyFeeInr: string;
  defaultRevenueSharePercent: string;
};

export type OverrideRowSlice = {
  monthlyFeeInrOverride: string | null;
  revenueSharePercentOverride: string | null;
};

export type MergedStrategyPricing = {
  monthlyFeeInr: string;
  revenueSharePercent: string;
  /** True when the effective override row supplies at least one non-null field. */
  hasOverride: boolean;
};

export function mergeStrategyPricing(
  defaults: StrategyDefaultPricing,
  override: OverrideRowSlice | null | undefined,
): MergedStrategyPricing {
  if (!override) {
    return {
      monthlyFeeInr: defaults.defaultMonthlyFeeInr,
      revenueSharePercent: defaults.defaultRevenueSharePercent,
      hasOverride: false,
    };
  }

  const feeFromOverride =
    override.monthlyFeeInrOverride != null &&
    String(override.monthlyFeeInrOverride).trim() !== "";
  const revFromOverride =
    override.revenueSharePercentOverride != null &&
    String(override.revenueSharePercentOverride).trim() !== "";

  const monthlyFeeInr = feeFromOverride
    ? String(override.monthlyFeeInrOverride)
    : defaults.defaultMonthlyFeeInr;
  const revenueSharePercent = revFromOverride
    ? String(override.revenueSharePercentOverride)
    : defaults.defaultRevenueSharePercent;

  return {
    monthlyFeeInr,
    revenueSharePercent,
    hasOverride: feeFromOverride || revFromOverride,
  };
}
