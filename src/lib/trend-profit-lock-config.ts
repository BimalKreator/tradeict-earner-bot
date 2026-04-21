import { z } from "zod";

export const trendProfitLockTimeframeSchema = z.enum([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
]);

const d2StepSchema = z.object({
  step: z.number().int().min(1).max(5),
  stepTriggerPct: z.number().finite().min(0).max(100),
  stepQtyPctOfD1: z.number().finite().min(0).max(100),
  stepTargetPct: z.number().finite().min(0).max(100),
  stepStoplossPct: z.number().finite().min(0).max(100),
});

export const trendProfitLockConfigBaseSchema = z.object({
  timeframe: trendProfitLockTimeframeSchema.default("1m"),
  halftrendAmplitude: z.number().int().min(1).default(2),
  symbol: z.string().trim().min(1).default("BTCUSD"),
  d1CapitalAllocationPct: z.number().finite().min(0).max(100).default(100),
  d1TargetPct: z.number().finite().min(0).max(100).default(12),
  d1StoplossPct: z.number().finite().min(0).max(100).default(1),
  d1BreakevenTriggerPct: z.number().finite().min(0).max(100).default(30),
  d2Steps: z.array(d2StepSchema).length(5),
});

export const trendProfitLockConfigSchema = trendProfitLockConfigBaseSchema.superRefine((cfg, ctx) => {
  let prevTrigger = -Infinity;
  let totalQtyPct = 0;
  for (let i = 0; i < cfg.d2Steps.length; i++) {
    const step = cfg.d2Steps[i]!;
    totalQtyPct += step.stepQtyPctOfD1;
    if (step.stepTriggerPct <= prevTrigger) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["d2Steps", i, "stepTriggerPct"],
        message: "Step trigger % must be strictly increasing across steps.",
      });
    }
    prevTrigger = step.stepTriggerPct;
  }
  if (totalQtyPct > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["d2Steps"],
      message: "Total D2 step qty (% of D1) cannot exceed 100%.",
    });
  }
});

export type TrendProfitLockConfig = z.infer<typeof trendProfitLockConfigSchema>;

export function defaultTrendProfitLockConfig(): TrendProfitLockConfig {
  return {
    timeframe: "1m",
    halftrendAmplitude: 2,
    symbol: "BTCUSD",
    d1CapitalAllocationPct: 100,
    d1TargetPct: 12,
    d1StoplossPct: 1,
    d1BreakevenTriggerPct: 30,
    d2Steps: [
      { step: 1, stepTriggerPct: 0.2, stepQtyPctOfD1: 20, stepTargetPct: 0.3, stepStoplossPct: 12 },
      { step: 2, stepTriggerPct: 0.4, stepQtyPctOfD1: 20, stepTargetPct: 0.3, stepStoplossPct: 12 },
      { step: 3, stepTriggerPct: 0.6, stepQtyPctOfD1: 20, stepTargetPct: 0.3, stepStoplossPct: 12 },
      { step: 4, stepTriggerPct: 0.8, stepQtyPctOfD1: 20, stepTargetPct: 0.3, stepStoplossPct: 12 },
      { step: 5, stepTriggerPct: 1.0, stepQtyPctOfD1: 20, stepTargetPct: 0.3, stepStoplossPct: 12 },
    ],
  };
}

export function isTrendProfitLockScalpingStrategySlug(slug: string): boolean {
  return slug.trim().toLowerCase().includes("trend-profit-lock-scalping");
}
