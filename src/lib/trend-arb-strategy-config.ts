import { z } from "zod";

export const trendArbTimeframeSchema = z.enum(["1m", "15m", "1h", "4h", "1d"]);

export const trendArbIndicatorSettingsSchema = z.object({
  amplitude: z.number().finite().min(2).default(9),
  channelDeviation: z.number().finite().min(1).default(2),
  timeframe: trendArbTimeframeSchema.default("4h"),
});

export const trendArbStrategyConfigSchema = z.object({
  symbol: z.string().trim().min(1, "Symbol is required."),
  capitalAllocationPct: z
    .number()
    .finite()
    .min(0, "Capital allocation must be >= 0.")
    .max(100, "Capital allocation must be <= 100."),
  indicatorSettings: trendArbIndicatorSettingsSchema,
  delta1: z.object({
    entryQtyPct: z
      .number()
      .finite()
      .min(0, "Delta 1 base qty must be >= 0.")
      .max(100, "Delta 1 base qty must be <= 100."),
    targetProfitPct: z
      .number()
      .finite()
      .min(0, "Delta 1 target profit must be >= 0.")
      .max(100, "Delta 1 target profit must be <= 100."),
    stopLossPct: z
      .number()
      .finite()
      .min(0, "Delta 1 stop loss must be >= 0.")
      .max(100, "Delta 1 stop loss must be <= 100.")
      .default(3),
    /**
     * Peak unrealized profit % on D1 must reach at least this value before a logical stop at
     * entry is armed. At 0 the soft breakeven path is disabled.
     */
    d1BreakevenTriggerPct: z
      .number()
      .finite()
      .min(0, "D1 breakeven trigger must be >= 0.")
      .max(100, "D1 breakeven trigger must be <= 100.")
      .default(0),
  }),
  delta2: z.object({
    stepQtyPct: z
      .number()
      .finite()
      .min(0, "Delta 2 step qty must be >= 0.")
      .max(100, "Delta 2 step qty must be <= 100."),
    stepMovePct: z
      .number()
      .finite()
      .min(0, "Delta 2 step move must be >= 0.")
      .max(100, "Delta 2 step move must be <= 100."),
    targetProfitPct: z
      .number()
      .finite()
      .min(0, "Delta 2 target profit must be >= 0.")
      .max(100, "Delta 2 target profit must be <= 100."),
    stopLossPct: z
      .number()
      .finite()
      .min(0, "Delta 2 stop loss must be >= 0.")
      .max(100, "Delta 2 stop loss must be <= 100.")
      .default(3),
  }),
});

export type TrendArbStrategyConfig = z.infer<typeof trendArbStrategyConfigSchema>;

export function isTrendArbitrageStrategySlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return normalized.includes("trend-arb");
}

export function formatTrendArbIndicatorSettings(
  input:
    | {
        amplitude?: number;
        channelDeviation?: number;
        timeframe?: z.infer<typeof trendArbTimeframeSchema>;
      }
    | null
    | undefined,
): string {
  return JSON.stringify(
    {
      amplitude: input?.amplitude ?? 9,
      channelDeviation: input?.channelDeviation ?? 2,
      timeframe: input?.timeframe ?? "4h",
    },
    null,
    2,
  );
}
