import { formatChartPointsForTextarea } from "@/lib/strategy-performance-chart";

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
  };
}
