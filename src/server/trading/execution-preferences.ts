import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";

function parsePositiveNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inrToUsd(rawInr: number): number | null {
  if (!(rawInr > 0) || !Number.isFinite(rawInr)) return null;
  const fxRaw = Number(process.env.USD_INR_RATE ?? "83");
  const fx = Number.isFinite(fxRaw) && fxRaw > 0 ? fxRaw : 83;
  const usd = rawInr / fx;
  return usd > 0 ? usd : null;
}

function readRawExecutionBlock(runSettingsJson: unknown): Record<string, unknown> | null {
  if (!runSettingsJson || typeof runSettingsJson !== "object") return null;
  const ex = (runSettingsJson as Record<string, unknown>).execution;
  if (!ex || typeof ex !== "object") return null;
  return ex as Record<string, unknown>;
}

/** Accepts 50, "50", "50x" (and comma-separated numerics). */
function coerceLeverageStringFromUnknown(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return String(v);
  }
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").replace(/x$/i, "").trim());
    if (Number.isFinite(n) && n > 0) return String(n);
  }
  return null;
}

function coerceAllocatedUsdFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
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
  const fromParsed = coerceLeverageStringFromUnknown(jsonLev);
  if (fromParsed) return fromParsed;

  const rawEx = readRawExecutionBlock(params.runSettingsJson);
  const fromRaw = rawEx ? coerceLeverageStringFromUnknown(rawEx.leverage) : null;
  if (fromRaw) return fromRaw;

  const col = coerceLeverageStringFromUnknown(params.columnLeverage?.trim() ?? "");
  if (col) return col;
  const admin = coerceLeverageStringFromUnknown(params.strategyMaxLeverage?.trim() ?? "");
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

  const rawEx = readRawExecutionBlock(params.runSettingsJson);
  const rawUsd = rawEx ? coerceAllocatedUsdFromUnknown(rawEx.allocatedCapitalUsd) : null;
  if (rawUsd != null) return rawUsd;

  const pct = parsed.execution?.capitalPercentage;
  if (typeof pct === "number" && Number.isFinite(pct) && pct > 0 && pct <= 100) {
    const admin = parsePositiveNum(params.recommendedCapitalInr);
    if (admin != null) return inrToUsd((pct / 100) * admin);
  }
  const rawPctVal = rawEx?.capitalPercentage;
  let rawPct: number | null = null;
  if (typeof rawPctVal === "number" && Number.isFinite(rawPctVal) && rawPctVal > 0 && rawPctVal <= 100) {
    rawPct = rawPctVal;
  } else if (typeof rawPctVal === "string") {
    const n = Number(String(rawPctVal).replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0 && n <= 100) rawPct = n;
  }
  if (rawPct != null) {
    const admin = parsePositiveNum(params.recommendedCapitalInr);
    if (admin != null) return inrToUsd((rawPct / 100) * admin);
  }

  /**
   * `user_strategy_runs.capital_to_use_inr` is a legacy column name: the settings UI
   * persists **USD** collateral here (same value as `execution.allocatedCapitalUsd`).
   * Do not apply INR→USD FX to this column.
   */
  const col = parsePositiveNum(params.columnCapital);
  if (col != null) return col;
  const admin = parsePositiveNum(params.recommendedCapitalInr);
  return admin != null ? inrToUsd(admin) : null;
}
