import { formatChartPointsForTextarea } from "@/lib/strategy-performance-chart";
import {
  defaultHedgeScalpingConfig,
  hedgeScalpingConfigSchema,
  hedgeScalpingTimeframeSchema,
  isHedgeScalpingStrategySlug,
  type HedgeScalpingTimeframe,
} from "@/lib/hedge-scalping-config";
import {
  isTrendArbitrageStrategySlug,
  trendArbStrategyConfigSchema,
} from "@/lib/trend-arb-strategy-config";

export type AdminStrategyFormDefaults = {
  slug: string;
  name: string;
  description: string;
  defaultMonthlyFeeInr: string;
  defaultRevenueSharePercent: string;
  visibility: "public" | "hidden";
  status: "active" | "paused" | "archived";
  riskLabel: "low" | "medium" | "high";
  recommendedCapitalInr: string;
  maxLeverage: string;
  performanceChartJsonText: string;
  hedgeScalping: {
    allowedSymbols: string;
    timeframe: HedgeScalpingTimeframe;
    halfTrendAmplitude: string;
    delta1BaseQtyPct: string;
    delta1TargetProfitPct: string;
    delta1StopLossPct: string;
    delta1BreakevenTriggerPct: string;
    delta2StepMovePct: string;
    delta2StepQtyPct: string;
    delta2TargetProfitPct: string;
    delta2StopLossPct: string;
  } | null;
  trendArb: {
    symbol: string;
    capitalAllocationPct: string;
    indicatorAmplitude: string;
    indicatorChannelDeviation: string;
    indicatorTimeframe: "1m" | "15m" | "1h" | "4h" | "1d";
    delta1EntryQtyPct: string;
    delta1TargetProfitPct: string;
    delta1StopLossPct: string;
    delta1BreakevenTriggerPct: string;
    delta2StepQtyPct: string;
    delta2StepMovePct: string;
    delta2TargetProfitPct: string;
    delta2StopLossPct: string;
  } | null;
};

export function strategyDefaultsFromRow(row: {
  slug: string;
  name: string;
  description: string | null;
  defaultMonthlyFeeInr: string;
  defaultRevenueSharePercent: string;
  visibility: string;
  status: string;
  riskLabel: string;
  recommendedCapitalInr: string | null;
  maxLeverage: string | null;
  performanceChartJson: { date: string; value: number }[] | null;
  settingsJson: Record<string, unknown> | null;
}): AdminStrategyFormDefaults {
  const statusRaw = row.status;
  const statusNorm =
    statusRaw === "hidden"
      ? "paused"
      : statusRaw === "active" ||
          statusRaw === "paused" ||
          statusRaw === "archived"
        ? statusRaw
        : "paused";

  const isHedgeScalping = isHedgeScalpingStrategySlug(row.slug);
  /** Hedge scalping takes precedence if slug matches both patterns. */
  const isTrendArb =
    !isHedgeScalping && isTrendArbitrageStrategySlug(row.slug);
  const trendArbParsed = isTrendArb
    ? trendArbStrategyConfigSchema.safeParse(row.settingsJson)
    : null;
  const hedgeParsed = isHedgeScalping
    ? hedgeScalpingConfigSchema.safeParse(row.settingsJson)
    : null;
  const rawTrendSettings = (row.settingsJson ?? {}) as Record<string, unknown>;
  const rawDelta1 = (rawTrendSettings.delta1 ?? {}) as Record<string, unknown>;
  const rawDelta2 = (rawTrendSettings.delta2 ?? {}) as Record<string, unknown>;
  const rawIndicatorSettings = (rawTrendSettings.indicatorSettings ?? {}) as Record<
    string,
    unknown
  >;

  const rawHs = (row.settingsJson ?? {}) as Record<string, unknown>;
  const rawHsGeneral = (rawHs.general ?? {}) as Record<string, unknown>;
  const rawHsD1 = (rawHs.delta1 ?? {}) as Record<string, unknown>;
  const rawHsD2 = (rawHs.delta2 ?? {}) as Record<string, unknown>;
  const hsFallback = defaultHedgeScalpingConfig();

  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    defaultMonthlyFeeInr: row.defaultMonthlyFeeInr,
    defaultRevenueSharePercent: row.defaultRevenueSharePercent,
    visibility: row.visibility === "hidden" ? "hidden" : "public",
    status: statusNorm,
    riskLabel:
      row.riskLabel === "low" || row.riskLabel === "high"
        ? row.riskLabel
        : "medium",
    recommendedCapitalInr: row.recommendedCapitalInr ?? "",
    maxLeverage: row.maxLeverage ?? "",
    performanceChartJsonText: formatChartPointsForTextarea(
      row.performanceChartJson,
    ),
    hedgeScalping: !isHedgeScalping
      ? null
      : {
          allowedSymbols: (() => {
            if (hedgeParsed?.success) return hedgeParsed.data.general.allowedSymbols;
            const rawAllowed = rawHsGeneral.allowedSymbols;
            if (typeof rawAllowed === "string" && rawAllowed.trim()) return rawAllowed.trim();
            const legacySym = rawHsGeneral.symbol;
            if (typeof legacySym === "string" && String(legacySym).trim()) {
              return String(legacySym).trim();
            }
            return hsFallback.general.allowedSymbols;
          })(),
          timeframe: (() => {
            const rawTf = String(
              hedgeParsed?.success
                ? hedgeParsed.data.general.timeframe
                : (rawHsGeneral.timeframe as string | undefined) ?? "",
            ).trim();
            const tf = hedgeScalpingTimeframeSchema.safeParse(rawTf);
            return tf.success ? tf.data : hsFallback.general.timeframe;
          })(),
          halfTrendAmplitude: String(
            hedgeParsed?.success
              ? hedgeParsed.data.general.halfTrendAmplitude
              : ((rawHsGeneral.halfTrendAmplitude as number | undefined) ??
                  hsFallback.general.halfTrendAmplitude),
          ),
          delta1BaseQtyPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta1.baseQtyPct
              : ((rawHsD1.baseQtyPct as number | undefined) ?? hsFallback.delta1.baseQtyPct),
          ),
          delta1TargetProfitPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta1.targetProfitPct
              : ((rawHsD1.targetProfitPct as number | undefined) ??
                  hsFallback.delta1.targetProfitPct),
          ),
          delta1StopLossPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta1.stopLossPct
              : ((rawHsD1.stopLossPct as number | undefined) ?? hsFallback.delta1.stopLossPct),
          ),
          delta1BreakevenTriggerPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta1.breakevenTriggerPct
              : ((rawHsD1.breakevenTriggerPct as number | undefined) ??
                  hsFallback.delta1.breakevenTriggerPct),
          ),
          delta2StepMovePct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta2.stepMovePct
              : ((rawHsD2.stepMovePct as number | undefined) ?? hsFallback.delta2.stepMovePct),
          ),
          delta2StepQtyPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta2.stepQtyPct
              : ((rawHsD2.stepQtyPct as number | undefined) ?? hsFallback.delta2.stepQtyPct),
          ),
          delta2TargetProfitPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta2.targetProfitPct
              : ((rawHsD2.targetProfitPct as number | undefined) ??
                  hsFallback.delta2.targetProfitPct),
          ),
          delta2StopLossPct: String(
            hedgeParsed?.success
              ? hedgeParsed.data.delta2.stopLossPct
              : ((rawHsD2.stopLossPct as number | undefined) ?? hsFallback.delta2.stopLossPct),
          ),
        },
    trendArb: !isTrendArb
      ? null
      : {
          symbol:
            (trendArbParsed?.success
              ? trendArbParsed.data.symbol
              : (rawTrendSettings.symbol as string | undefined)) ?? "BTC_USDT",
          capitalAllocationPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.capitalAllocationPct
              : ((rawTrendSettings.capitalAllocationPct as number | undefined) ?? 100),
          ),
          indicatorAmplitude: String(
            trendArbParsed?.success
              ? (trendArbParsed.data.indicatorSettings.amplitude ?? 9)
              : ((rawIndicatorSettings.amplitude as number | undefined) ?? 9),
          ),
          indicatorChannelDeviation: String(
            trendArbParsed?.success
              ? (trendArbParsed.data.indicatorSettings.channelDeviation ?? 2)
              : ((rawIndicatorSettings.channelDeviation as number | undefined) ?? 2),
          ),
          indicatorTimeframe:
            trendArbParsed?.success
              ? trendArbParsed.data.indicatorSettings.timeframe
              : ((rawIndicatorSettings.timeframe as
                    | "1m"
                    | "15m"
                    | "1h"
                    | "4h"
                    | "1d"
                    | undefined) ?? "4h"),
          delta1EntryQtyPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta1.entryQtyPct
              : ((rawDelta1.entryQtyPct as number | undefined) ?? 100),
          ),
          delta1TargetProfitPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta1.targetProfitPct
              : ((rawDelta1.targetProfitPct as number | undefined) ?? 1),
          ),
          delta1StopLossPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta1.stopLossPct
              : ((rawDelta1.stopLossPct as number | undefined) ?? 3),
          ),
          delta1BreakevenTriggerPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta1.d1BreakevenTriggerPct
              : ((rawDelta1.d1BreakevenTriggerPct as number | undefined) ?? 0),
          ),
          delta2StepQtyPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta2.stepQtyPct
              : ((rawDelta2.stepQtyPct as number | undefined) ?? 10),
          ),
          delta2StepMovePct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta2.stepMovePct
              : ((rawDelta2.stepMovePct as number | undefined) ?? 1),
          ),
          delta2TargetProfitPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta2.targetProfitPct
              : ((rawDelta2.targetProfitPct as number | undefined) ?? 1),
          ),
          delta2StopLossPct: String(
            trendArbParsed?.success
              ? trendArbParsed.data.delta2.stopLossPct
              : ((rawDelta2.stopLossPct as number | undefined) ?? 3),
          ),
        },
  };
}
