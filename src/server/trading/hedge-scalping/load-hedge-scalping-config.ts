import {
  defaultHedgeScalpingConfig,
  hedgeScalpingConfigSchema,
  type HedgeScalpingConfig,
} from "@/lib/hedge-scalping-config";

function coerceNumericFields(obj: Record<string, unknown>, keys: string[]): void {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) obj[k] = n;
    }
  }
}

/** Coerce stringified numbers and legacy `delta1.baseQty` → `baseQtyPct` before Zod parse. */
export function normalizeHedgeScalpingSettingsJson(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const root: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  if (root.general && typeof root.general === "object") {
    const g: Record<string, unknown> = { ...(root.general as Record<string, unknown>) };
    coerceNumericFields(g, ["halfTrendAmplitude", "maxEntryDistanceFromSignalPct"]);
    root.general = g;
  }

  if (root.delta1 && typeof root.delta1 === "object") {
    const d1: Record<string, unknown> = { ...(root.delta1 as Record<string, unknown>) };
    coerceNumericFields(d1, [
      "baseQtyPct",
      "baseQty",
      "targetProfitPct",
      "stopLossPct",
      "breakevenTriggerPct",
    ]);
    if (d1.baseQtyPct == null && d1.baseQty != null) {
      d1.baseQtyPct = d1.baseQty;
    }
    root.delta1 = d1;
  }

  if (root.delta2 && typeof root.delta2 === "object") {
    const d2: Record<string, unknown> = { ...(root.delta2 as Record<string, unknown>) };
    coerceNumericFields(d2, ["stepMovePct", "stepQtyPct", "targetProfitPct", "stopLossPct"]);
    root.delta2 = d2;
  }

  return root;
}

/**
 * Merge partial / legacy `settings_json` with canonical defaults, then validate.
 * Use for user-facing UI and validations where missing `general.*` keys must not crash.
 */
export function resolveHedgeScalpingConfigForUi(settingsJson: unknown): HedgeScalpingConfig {
  const defaults = defaultHedgeScalpingConfig();
  const normalized = normalizeHedgeScalpingSettingsJson(settingsJson);
  const root =
    normalized != null && typeof normalized === "object" && !Array.isArray(normalized)
      ? (normalized as Record<string, unknown>)
      : {};

  const mergeSection = <K extends keyof HedgeScalpingConfig>(key: K): HedgeScalpingConfig[K] => {
    const patch = root[key as string];
    const base = defaults[key];
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return { ...base };
    }
    return { ...base, ...(patch as Record<string, unknown>) } as HedgeScalpingConfig[K];
  };

  const candidate: HedgeScalpingConfig = {
    general: mergeSection("general"),
    delta1: mergeSection("delta1"),
    delta2: mergeSection("delta2"),
  };

  const parsed = hedgeScalpingConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : defaults;
}

/**
 * Parse `strategies.settings_json` for Hedge Scalping. Returns `null` if invalid or missing.
 */
export function parseHedgeScalpingStrategySettings(
  settingsJson: unknown,
): HedgeScalpingConfig | null {
  const normalized = normalizeHedgeScalpingSettingsJson(settingsJson);
  const parsed = hedgeScalpingConfigSchema.safeParse(normalized ?? {});
  return parsed.success ? parsed.data : null;
}
