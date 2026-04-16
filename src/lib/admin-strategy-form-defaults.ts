import { formatChartPointsForTextarea } from "@/lib/strategy-performance-chart";
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
  trendArb: {
    symbol: string;
    capitalAllocationPct: string;
    indicatorAmplitude: string;
    indicatorChannelDeviation: string;
    delta1EntryQtyPct: string;
    delta1TargetProfitPct: string;
    delta1StopLossPct: string;
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

  const isTrendArb = isTrendArbitrageStrategySlug(row.slug);
  const trendArbParsed = isTrendArb
    ? trendArbStrategyConfigSchema.safeParse(row.settingsJson)
    : null;
  const rawTrendSettings = (row.settingsJson ?? {}) as Record<string, unknown>;
  const rawDelta1 = (rawTrendSettings.delta1 ?? {}) as Record<string, unknown>;
  const rawDelta2 = (rawTrendSettings.delta2 ?? {}) as Record<string, unknown>;
  const rawIndicatorSettings = (rawTrendSettings.indicatorSettings ?? {}) as Record<
    string,
    unknown
  >;

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
