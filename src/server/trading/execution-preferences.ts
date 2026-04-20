import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";

function parsePositiveNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inrToUsd(rawInr: number): number | null {
  if (!(rawInr > 0) || !Number.isFinite(rawInr)) return null;
  const fxRaw = Number(process.env.USD_INR_RATE ?? "83");
  const fx = Number.isFinite(fxRaw) && fxRaw > 0 ? fxRaw : 83;
  const usd = rawInr / fx;
  return usd > 0 ? usd : null;
}

/**
 * User execution preferences override admin/strategy defaults:
 * `run_settings_json.execution` → `user_strategy_runs` columns → strategy catalog.
 */
export function resolveRawLeverageStringForExecution(params: {
  runSettingsJson: unknown;
  columnLeverage: string | null | undefined;
  /** Admin fallback when the user column is empty (should be rare for active runs). */
  strategyMaxLeverage: string | null | undefined;
}): string {
  const parsed = parseUserStrategyRunSettingsJson(params.runSettingsJson);
  const jsonLev = parsed.execution?.leverage;
  if (typeof jsonLev === "number" && Number.isFinite(jsonLev) && jsonLev > 0) {
    return String(jsonLev);
  }
  const col = params.columnLeverage?.trim();
  if (col) return col;
  const admin = params.strategyMaxLeverage?.trim();
  return admin ?? "";
}

export function resolveFinalAllocatedCapitalUsd(params: {
  runSettingsJson: unknown;
  columnCapital: string | null | undefined;
  recommendedCapitalInr: string | null | undefined;
}): number | null {
  const parsed = parseUserStrategyRunSettingsJson(params.runSettingsJson);
  const jsonUsd = parsed.execution?.allocatedCapitalUsd;
  if (typeof jsonUsd === "number" && Number.isFinite(jsonUsd) && jsonUsd > 0) {
    return jsonUsd;
  }
  const pct = parsed.execution?.capitalPercentage;
  if (typeof pct === "number" && Number.isFinite(pct) && pct > 0 && pct <= 100) {
    const admin = parsePositiveNum(params.recommendedCapitalInr);
    if (admin != null) return inrToUsd((pct / 100) * admin);
  }
  const col = parsePositiveNum(params.columnCapital);
  if (col != null) return inrToUsd(col);
  const admin = parsePositiveNum(params.recommendedCapitalInr);
  return admin != null ? inrToUsd(admin) : null;
}
