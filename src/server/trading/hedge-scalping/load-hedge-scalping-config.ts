import {
  hedgeScalpingConfigSchema,
  type HedgeScalpingConfig,
} from "@/lib/hedge-scalping-config";

/**
 * Parse `strategies.settings_json` for Hedge Scalping. Returns `null` if invalid or missing.
 */
export function parseHedgeScalpingStrategySettings(
  settingsJson: unknown,
): HedgeScalpingConfig | null {
  const parsed = hedgeScalpingConfigSchema.safeParse(settingsJson ?? {});
  return parsed.success ? parsed.data : null;
}
