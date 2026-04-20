import { z } from "zod";

const hedgeScalpingRunSymbolSchema = z.object({
  symbol: z.string().trim().min(1),
});

const executionPreferencesSchema = z.object({
  /** User-owned collateral for Delta sizing (USD); mirrors the run column when saved from the UI. */
  allocatedCapitalUsd: z.number().positive().optional(),
  /** When set without `allocatedCapitalUsd`, scales strategy recommended capital (0–100). */
  capitalPercentage: z.number().min(0).max(100).optional(),
  leverage: z.number().positive().optional(),
});

/** JSON stored on `user_strategy_runs.run_settings_json` / `virtual_strategy_runs.run_settings_json`. */
export const userStrategyRunSettingsJsonSchema = z.object({
  hedgeScalping: hedgeScalpingRunSymbolSchema.optional(),
  execution: executionPreferencesSchema.optional(),
});

export type UserStrategyRunSettingsJson = z.infer<typeof userStrategyRunSettingsJsonSchema>;

export function parseUserStrategyRunSettingsJson(
  raw: unknown,
): UserStrategyRunSettingsJson {
  const r = userStrategyRunSettingsJsonSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export function extractHedgeScalpingSymbolFromRunSettingsJson(raw: unknown): string | null {
  const parsed = parseUserStrategyRunSettingsJson(raw);
  const s = parsed.hedgeScalping?.symbol?.trim();
  return s && s.length > 0 ? s : null;
}

export function withHedgeScalpingRunSymbol(
  existing: unknown,
  symbol: string,
): Record<string, unknown> {
  const base = parseUserStrategyRunSettingsJson(existing);
  return {
    ...base,
    hedgeScalping: { symbol: symbol.trim() },
  };
}

export function withExecutionPreferences(
  existing: unknown,
  prefs: { allocatedCapitalUsd: number; leverage?: number },
): Record<string, unknown> {
  const base = parseUserStrategyRunSettingsJson(existing);
  const prevExec = base.execution ?? {};
  return {
    ...base,
    execution: {
      ...prevExec,
      allocatedCapitalUsd: prefs.allocatedCapitalUsd,
      ...(prefs.leverage != null &&
      Number.isFinite(prefs.leverage) &&
      prefs.leverage > 0
        ? { leverage: prefs.leverage }
        : {}),
    },
  };
}
