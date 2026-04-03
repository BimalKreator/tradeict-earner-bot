import { and, count, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { db } from "@/server/db";
import {
  strategies,
  strategyPerformanceSnapshots,
  userStrategyPricingOverrides,
  userStrategySubscriptions,
} from "@/server/db/schema";

export type AdminStrategyListRow = {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  status: string;
  riskLabel: string;
  defaultMonthlyFeeInr: string;
  defaultRevenueSharePercent: string;
  recommendedCapitalInr: string | null;
  maxLeverage: string | null;
  updatedAt: Date;
  /** Any user has a live active override on this strategy. */
  hasActiveUserPricingOverride: boolean;
};

export async function listStrategiesForAdmin(): Promise<AdminStrategyListRow[]> {
  if (!db) return [];

  const now = new Date();

  const [rows, overrideFlags] = await Promise.all([
    db
    .select({
      id: strategies.id,
      slug: strategies.slug,
      name: strategies.name,
      visibility: strategies.visibility,
      status: strategies.status,
      riskLabel: strategies.riskLabel,
      defaultMonthlyFeeInr: strategies.defaultMonthlyFeeInr,
      defaultRevenueSharePercent: strategies.defaultRevenueSharePercent,
      recommendedCapitalInr: strategies.recommendedCapitalInr,
      maxLeverage: strategies.maxLeverage,
      updatedAt: strategies.updatedAt,
    })
      .from(strategies)
      .where(isNull(strategies.deletedAt)),
    db
      .select({
        strategyId: userStrategyPricingOverrides.strategyId,
      })
      .from(userStrategyPricingOverrides)
      .where(
        and(
          eq(userStrategyPricingOverrides.isActive, true),
          lte(userStrategyPricingOverrides.effectiveFrom, now),
          or(
            isNull(userStrategyPricingOverrides.effectiveUntil),
            gt(userStrategyPricingOverrides.effectiveUntil, now),
          ),
        ),
      )
      .groupBy(userStrategyPricingOverrides.strategyId),
  ]);

  const overrideSet = new Set(overrideFlags.map((o) => o.strategyId));

  return rows.map((r) => ({
    ...r,
    defaultMonthlyFeeInr: String(r.defaultMonthlyFeeInr),
    defaultRevenueSharePercent: String(r.defaultRevenueSharePercent),
    recommendedCapitalInr: r.recommendedCapitalInr
      ? String(r.recommendedCapitalInr)
      : null,
    maxLeverage: r.maxLeverage ? String(r.maxLeverage) : null,
    hasActiveUserPricingOverride: overrideSet.has(r.id),
  }));
}

export type AdminStrategyDetail = {
  strategy: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    visibility: string;
    status: string;
    riskLabel: string;
    defaultMonthlyFeeInr: string;
    defaultRevenueSharePercent: string;
    recommendedCapitalInr: string | null;
    maxLeverage: string | null;
    performanceChartJson: { date: string; value: number }[] | null;
    createdAt: Date;
    updatedAt: Date;
  };
  subscriptionActiveCount: number;
  subscriptionTotalCount: number;
  recentSnapshots: {
    id: string;
    capturedAt: Date;
    metricEquityInr: string | null;
    metricReturnPct: string | null;
  }[];
};

export async function getAdminStrategyDetail(
  strategyId: string,
): Promise<AdminStrategyDetail | null> {
  if (!db) return null;

  const now = new Date();

  const [strat, activeRow, totalRow, snaps] = await Promise.all([
    db
      .select({
        id: strategies.id,
        slug: strategies.slug,
        name: strategies.name,
        description: strategies.description,
        visibility: strategies.visibility,
        status: strategies.status,
        riskLabel: strategies.riskLabel,
        defaultMonthlyFeeInr: strategies.defaultMonthlyFeeInr,
        defaultRevenueSharePercent: strategies.defaultRevenueSharePercent,
        recommendedCapitalInr: strategies.recommendedCapitalInr,
        maxLeverage: strategies.maxLeverage,
        performanceChartJson: strategies.performanceChartJson,
        createdAt: strategies.createdAt,
        updatedAt: strategies.updatedAt,
      })
      .from(strategies)
      .where(
        and(eq(strategies.id, strategyId), isNull(strategies.deletedAt)),
      )
      .limit(1),
    db
      .select({ c: count() })
      .from(userStrategySubscriptions)
      .where(
        and(
          eq(userStrategySubscriptions.strategyId, strategyId),
          isNull(userStrategySubscriptions.deletedAt),
          eq(userStrategySubscriptions.status, "active"),
          gt(userStrategySubscriptions.accessValidUntil, now),
        ),
      ),
    db
      .select({ c: count() })
      .from(userStrategySubscriptions)
      .where(
        and(
          eq(userStrategySubscriptions.strategyId, strategyId),
          isNull(userStrategySubscriptions.deletedAt),
        ),
      ),
    db
      .select({
        id: strategyPerformanceSnapshots.id,
        capturedAt: strategyPerformanceSnapshots.capturedAt,
        metricEquityInr: strategyPerformanceSnapshots.metricEquityInr,
        metricReturnPct: strategyPerformanceSnapshots.metricReturnPct,
      })
      .from(strategyPerformanceSnapshots)
      .where(eq(strategyPerformanceSnapshots.strategyId, strategyId))
      .orderBy(desc(strategyPerformanceSnapshots.capturedAt))
      .limit(10),
  ]);

  const s = strat[0];
  if (!s) return null;

  return {
    strategy: {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      visibility: s.visibility,
      status: s.status,
      riskLabel: s.riskLabel,
      defaultMonthlyFeeInr: String(s.defaultMonthlyFeeInr),
      defaultRevenueSharePercent: String(s.defaultRevenueSharePercent),
      recommendedCapitalInr: s.recommendedCapitalInr
        ? String(s.recommendedCapitalInr)
        : null,
      maxLeverage: s.maxLeverage ? String(s.maxLeverage) : null,
      performanceChartJson: s.performanceChartJson ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    },
    subscriptionActiveCount: Number(activeRow[0]?.c ?? 0),
    subscriptionTotalCount: Number(totalRow[0]?.c ?? 0),
    recentSnapshots: snaps.map((x) => ({
      id: x.id,
      capturedAt: x.capturedAt,
      metricEquityInr: x.metricEquityInr != null ? String(x.metricEquityInr) : null,
      metricReturnPct:
        x.metricReturnPct != null ? String(x.metricReturnPct) : null,
    })),
  };
}
