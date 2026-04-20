import { z } from "zod";

/** Candle resolution for HalfTrend / bar context (Phase 1). */
export const hedgeScalpingTimeframeSchema = z.enum([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
]);

export type HedgeScalpingTimeframe = z.infer<typeof hedgeScalpingTimeframeSchema>;

const hedgeScalpingGeneralSchemaBase = z.object({
  /**
   * Comma- or semicolon-separated venue symbols (e.g. `BTCUSD, ETHUSD`).
   * Users pick one per run; stored on `user_strategy_runs.run_settings_json` / virtual run JSON.
   */
  allowedSymbols: z.string().trim().min(1, "At least one allowed symbol is required.").default("BTCUSD"),
  timeframe: hedgeScalpingTimeframeSchema.default("5m"),
  halfTrendAmplitude: z.number().finite().min(0.01).default(2),
  /**
   * NEW_RUN guard: reject when |close − HalfTrend ht| / ht × 100 exceeds this (breakout candles).
   */
  maxEntryDistanceFromSignalPct: z
    .number()
    .finite()
    .min(0, "Max entry distance % must be >= 0.")
    .max(100, "Max entry distance % must be <= 100.")
    .default(2.0),
});

/** Accepts legacy rows that used `general.symbol` instead of `allowedSymbols`. */
export const hedgeScalpingGeneralSchema = z.preprocess((val) => {
  if (val && typeof val === "object" && !("allowedSymbols" in val) && "symbol" in val) {
    const v = val as Record<string, unknown>;
    const sym = typeof v.symbol === "string" ? v.symbol.trim() : "";
    const { symbol: _omit, ...rest } = v;
    return { ...rest, allowedSymbols: sym.length > 0 ? sym : "BTCUSD" };
  }
  return val;
}, hedgeScalpingGeneralSchemaBase);

/** Normalize admin / DB string into unique uppercase symbols. */
export function parseAllowedSymbolsList(allowedSymbols: string): string[] {
  const parts = allowedSymbols
    .split(/[,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  return [...new Set(parts)];
}

export const hedgeScalpingDelta1Schema = z.object({
  /** Percentage of capital allocated to the main (D1) account. */
  baseQtyPct: z
    .number()
    .finite()
    .min(0, "D1 base qty % must be >= 0.")
    .max(100, "D1 base qty % must be <= 100.")
    .default(100),
  targetProfitPct: z
    .number()
    .finite()
    .min(0, "D1 target profit % must be >= 0.")
    .max(100, "D1 target profit % must be <= 100.")
    .default(5),
  stopLossPct: z
    .number()
    .finite()
    .min(0, "D1 stop loss % must be >= 0.")
    .max(100, "D1 stop loss % must be <= 100.")
    .default(1),
  /**
   * Legacy / reserved field (not used for virtual D1 exits). D1 stop is a continuous 1:1 trail
   * from the initial %-based stop, keyed off `max_favorable_price` vs entry.
   */
  breakevenTriggerPct: z
    .number()
    .finite()
    .min(0, "D1 breakeven trigger % must be >= 0.")
    .max(100, "D1 breakeven trigger % must be <= 100.")
    .default(30),
});

export const hedgeScalpingDelta2Schema = z.object({
  stepMovePct: z
    .number()
    .finite()
    .min(0, "D2 step move % must be >= 0.")
    .max(100, "D2 step move % must be <= 100.")
    .default(0.5),
  stepQtyPct: z
    .number()
    .finite()
    .min(0, "D2 step qty % must be >= 0.")
    .max(100, "D2 step qty % must be <= 100.")
    .default(10),
  targetProfitPct: z
    .number()
    .finite()
    .min(0, "D2 target profit % must be >= 0.")
    .max(100, "D2 target profit % must be <= 100.")
    .default(0.5),
  stopLossPct: z
    .number()
    .finite()
    .min(0, "D2 stop loss % must be >= 0.")
    .max(100, "D2 stop loss % must be <= 100.")
    .default(5),
});

/**
 * Hedge Scalping (Dual Account System) — persisted under `strategies.settings_json`.
 * Phase 1: schema only; execution is not wired yet.
 */
export const hedgeScalpingConfigSchema = z.object({
  general: hedgeScalpingGeneralSchema,
  delta1: hedgeScalpingDelta1Schema,
  delta2: hedgeScalpingDelta2Schema,
});

export type HedgeScalpingConfig = z.infer<typeof hedgeScalpingConfigSchema>;

/** Canonical defaults for new rows and admin forms. */
export function defaultHedgeScalpingConfig(): HedgeScalpingConfig {
  return {
    general: hedgeScalpingGeneralSchema.parse({}),
    delta1: hedgeScalpingDelta1Schema.parse({}),
    delta2: hedgeScalpingDelta2Schema.parse({}),
  };
}

export function isHedgeScalpingStrategySlug(slug: string): boolean {
  return slug.trim().toLowerCase().includes("hedge-scalping");
}
