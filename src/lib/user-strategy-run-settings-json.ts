import { z } from "zod";
import { trendProfitLockConfigBaseSchema } from "./trend-profit-lock-config";

const hedgeScalpingRunSymbolSchema = z.object({
  symbol: z.string().trim().min(1),
});

function parseLooseUsdAmount(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function parseLooseLeverage(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").replace(/x$/i, "").trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function parseLooseCapitalPct(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  }
  return undefined;
}

const executionPreferencesSchema = z
  .object({
    /** User-owned collateral for Delta sizing (USD); mirrors the run column when saved from the UI. */
    allocatedCapitalUsd: z.unknown().optional(),
    /** When set without `allocatedCapitalUsd`, scales strategy recommended capital (0–100). */
    capitalPercentage: z.unknown().optional(),
    leverage: z.unknown().optional(),
  })
  .transform((o) => ({
    allocatedCapitalUsd: parseLooseUsdAmount(o.allocatedCapitalUsd),
    capitalPercentage: parseLooseCapitalPct(o.capitalPercentage),
    leverage: parseLooseLeverage(o.leverage),
  }));

/** Last Trend Profit Lock exit hint for Live Trades UI toasts (merged into raw JSON; optional). */
const lastTplTradeExitUiSchema = z.object({
  reason: z.string(),
  at: z.string(),
  leg: z.string().optional(),
});

const trendProfitLockRuntimeSchema = z.object({
  lastFlipCandleTime: z.number().int().optional(),
  lastCompletedD1FlipDirection: z.enum(["LONG", "SHORT"]).optional(),
  isManualClosed: z.boolean().optional(),
  mockNextFlipDirection: z.enum(["UP", "DOWN"]).optional(),
  d1BaseQtyInt: z.number().int().positive().optional(),
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
      takeProfitOrderExternalId: z.string().optional(),
      takeProfitOrderClientId: z.string().optional(),
      takeProfitPlacedAt: z.string().optional(),
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
        status: z.enum(["drafting", "submitting", "open", "closed"]),
        closeReason: z.enum(["target", "stoploss", "unknown"]).optional(),
        closedAt: z.string().optional(),
        takeProfitOrderExternalId: z.string().optional(),
        takeProfitOrderClientId: z.string().optional(),
        takeProfitPlacedAt: z.string().optional(),
        stopLossOrderExternalId: z.string().optional(),
        stopLossOrderClientId: z.string().optional(),
        stopLossPlacedAt: z.string().optional(),
        /** SL loop guard: block same-step immediate reload after SL exits. */
        slHitLock: z.boolean().optional(),
        /** Price level that must be revisited after moving away before reload is allowed. */
        rearmTriggerPrice: z.number().finite().optional(),
        /** Set once mark moves significantly away from trigger in opposite direction. */
        rearmSeenAway: z.boolean().optional(),
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
  lastTplTradeExitUi: lastTplTradeExitUiSchema.optional(),
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
