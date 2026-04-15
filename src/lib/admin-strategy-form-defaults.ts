import { formatChartPointsForTextarea } from "@/lib/strategy-performance-chart";
import {
  formatTrendArbIndicatorSettings,
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
    indicatorSettingsJsonText: string;
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
      : trendArbParsed?.success
        ? {
            symbol: trendArbParsed.data.symbol,
            capitalAllocationPct: String(trendArbParsed.data.capitalAllocationPct),
            indicatorSettingsJsonText: formatTrendArbIndicatorSettings(
              trendArbParsed.data.indicatorSettings,
            ),
            delta1EntryQtyPct: String(trendArbParsed.data.delta1.entryQtyPct),
            delta1TargetProfitPct: String(trendArbParsed.data.delta1.targetProfitPct),
            delta1StopLossPct: String(trendArbParsed.data.delta1.stopLossPct),
            delta2StepQtyPct: String(trendArbParsed.data.delta2.stepQtyPct),
            delta2StepMovePct: String(trendArbParsed.data.delta2.stepMovePct),
            delta2TargetProfitPct: String(trendArbParsed.data.delta2.targetProfitPct),
            delta2StopLossPct: String(trendArbParsed.data.delta2.stopLossPct),
          }
        : {
            symbol: "BTC_USDT",
            capitalAllocationPct: "100",
            indicatorSettingsJsonText: "{}",
            delta1EntryQtyPct: "100",
            delta1TargetProfitPct: "1",
            delta1StopLossPct: "3",
            delta2StepQtyPct: "10",
            delta2StepMovePct: "1",
            delta2TargetProfitPct: "1",
            delta2StopLossPct: "3",
          },
  };
}
