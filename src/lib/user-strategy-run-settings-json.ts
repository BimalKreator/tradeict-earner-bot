import { z } from "zod";
import { trendProfitLockConfigBaseSchema } from "./trend-profit-lock-config";

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

const trendProfitLockRuntimeSchema = z.object({
  lastFlipCandleTime: z.number().int().optional(),
  lastCompletedD1FlipDirection: z.enum(["LONG", "SHORT"]).optional(),
  d1: z
    .object({
      side: z.enum(["LONG", "SHORT"]),
      entryPrice: z.number().finite(),
      targetPrice: z.number().finite(),
      stoplossPrice: z.number().finite(),
      breakevenTriggerPct: z.number().finite(),
      breakevenQueuedAt: z.string().optional(),
      breakevenExecutedAt: z.string().optional(),
      breakevenOrderCorrelationId: z.string().optional(),
      stopLossOrderExternalId: z.string().optional(),
      stopLossOrderClientId: z.string().optional(),
      stopLossPlacedAt: z.string().optional(),
    })
    .optional(),
  d2TriggeredSteps: z.array(z.number().int()).optional(),
  d2StepsState: z
    .record(
      z.string(),
      z.object({
        step: z.number().int(),
        triggerPrice: z.number().finite(),
        entryMarkPrice: z.number().finite(),
        side: z.enum(["LONG", "SHORT"]),
        qty: z.number().int().positive(),
        targetPrice: z.number().finite(),
        stoplossPrice: z.number().finite(),
        executedAt: z.string(),
        correlationId: z.string(),
        status: z.enum(["open", "closed"]),
        closeReason: z.enum(["target", "stoploss", "unknown"]).optional(),
        closedAt: z.string().optional(),
      }),
    )
    .optional(),
});

/** JSON stored on `user_strategy_runs.run_settings_json` / `virtual_strategy_runs.run_settings_json`. */
export const userStrategyRunSettingsJsonSchema = z.object({
  hedgeScalping: hedgeScalpingRunSymbolSchema.optional(),
  trendProfitLock: trendProfitLockConfigBaseSchema.partial().optional(),
  trendProfitLockRuntime: trendProfitLockRuntimeSchema.optional(),
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

export function withTrendProfitLockRunSettings(
  existing: unknown,
  trendProfitLock: Record<string, unknown>,
): Record<string, unknown> {
  const base = parseUserStrategyRunSettingsJson(existing);
  return {
    ...base,
    trendProfitLock,
  };
}
