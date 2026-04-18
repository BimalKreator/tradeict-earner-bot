import { z } from "zod";

const hedgeScalpingRunSymbolSchema = z.object({
  symbol: z.string().trim().min(1),
});

/** JSON stored on `user_strategy_runs.run_settings_json` / `virtual_strategy_runs.run_settings_json`. */
export const userStrategyRunSettingsJsonSchema = z.object({
  hedgeScalping: hedgeScalpingRunSymbolSchema.optional(),
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
