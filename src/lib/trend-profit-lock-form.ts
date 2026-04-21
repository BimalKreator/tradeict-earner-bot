import {
  defaultTrendProfitLockConfig,
  trendProfitLockTargetLinkTypeSchema,
  trendProfitLockConfigSchema,
  type TrendProfitLockConfig,
} from "./trend-profit-lock-config";

export type TrendProfitLockFormParseResult =
  | { ok: true; value: TrendProfitLockConfig }
  | { ok: false; fieldErrors: Record<string, string[]> };

function n(raw: FormDataEntryValue | null): number {
  return Number(String(raw ?? "").trim());
}

export function parseTrendProfitLockConfigFromFormData(
  formData: FormData,
): TrendProfitLockFormParseResult {
  const value = {
    timeframe: String(formData.get("tpl_timeframe") ?? "").trim(),
    halftrendAmplitude: n(formData.get("tpl_halftrend_amplitude")),
    symbol: String(formData.get("tpl_symbol") ?? "").trim().toUpperCase(),
    d1CapitalAllocationPct: n(formData.get("tpl_d1_capital_allocation_pct")),
    d1TargetPct: n(formData.get("tpl_d1_target_pct")),
    d1StoplossPct: n(formData.get("tpl_d1_stoploss_pct")),
    d1BreakevenTriggerPct: n(formData.get("tpl_d1_breakeven_trigger_pct")),
    d2Steps: Array.from({ length: 5 }).map((_, idx) => {
      const step = idx + 1;
      return {
        step,
        stepTriggerPct: n(formData.get(`tpl_d2_step_${step}_trigger_pct`)),
        stepQtyPctOfD1: n(formData.get(`tpl_d2_step_${step}_qty_pct_of_d1`)),
        targetLinkType:
          trendProfitLockTargetLinkTypeSchema.safeParse(
            String(formData.get(`tpl_d2_step_${step}_target_link_type`) ?? "").trim(),
          ).success
            ? String(formData.get(`tpl_d2_step_${step}_target_link_type`) ?? "").trim()
            : "D1_ENTRY",
        stepStoplossPct: n(formData.get(`tpl_d2_step_${step}_stoploss_pct`)),
      };
    }),
  };

  const parsed = trendProfitLockConfigSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const p0 = issue.path[0];
    const p1 = issue.path[1];
    const p2 = issue.path[2];
    let key = "tpl_trend_profit_lock";
    let message = issue.message;

    if (p0 === "timeframe") key = "tpl_timeframe";
    else if (p0 === "halftrendAmplitude") key = "tpl_halftrend_amplitude";
    else if (p0 === "symbol") key = "tpl_symbol";
    else if (p0 === "d1CapitalAllocationPct") key = "tpl_d1_capital_allocation_pct";
    else if (p0 === "d1TargetPct") key = "tpl_d1_target_pct";
    else if (p0 === "d1StoplossPct") key = "tpl_d1_stoploss_pct";
    else if (p0 === "d1BreakevenTriggerPct") key = "tpl_d1_breakeven_trigger_pct";
    else if (p0 === "d2Steps" && typeof p1 === "number") {
      const step = p1 + 1;
      if (p2 === "stepTriggerPct") {
        key = `tpl_d2_step_${step}_trigger_pct`;
        if (issue.message.toLowerCase().includes("strictly increasing")) {
          message = `Step ${step} trigger must be greater than Step ${step - 1}`;
        }
      } else if (p2 === "stepQtyPctOfD1") key = `tpl_d2_step_${step}_qty_pct_of_d1`;
      else if (p2 === "targetLinkType") key = `tpl_d2_step_${step}_target_link_type`;
      else if (p2 === "stepStoplossPct") key = `tpl_d2_step_${step}_stoploss_pct`;
    } else if (p0 === "d2Steps" && issue.message.toLowerCase().includes("cannot exceed 100")) {
      key = "tpl_d2_total_allocation";
      message = "Total D2 Step Allocation cannot exceed 100%";
    }

    fieldErrors[key] = [message];
  }
  return { ok: false, fieldErrors };
}

export function resolveTrendProfitLockConfigForUi(params: {
  strategySettingsJson: unknown;
  runSettingsTrendProfitLock?: unknown;
}): TrendProfitLockConfig {
  const defaults = trendProfitLockConfigSchema.safeParse(params.strategySettingsJson);
  const base = defaults.success ? defaults.data : defaultTrendProfitLockConfig();
  const runPartial =
    params.runSettingsTrendProfitLock &&
    typeof params.runSettingsTrendProfitLock === "object"
      ? (params.runSettingsTrendProfitLock as Record<string, unknown>)
      : {};
  const merged = { ...base, ...runPartial };
  const parsed = trendProfitLockConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}
