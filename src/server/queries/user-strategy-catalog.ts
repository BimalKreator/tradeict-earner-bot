import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import { mergeStrategyPricing } from "@/lib/user-strategy-pricing";
import { db } from "@/server/db";
import {
  strategies,
  userStrategyPricingOverrides,
  userStrategySubscriptions,
} from "@/server/db/schema";

export type CatalogStrategyRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultMonthlyFeeInr: string;
  defaultRevenueSharePercent: string;
  riskLabel: string;
  recommendedCapitalInr: string | null;
  performanceChartJson: unknown;
};

export type UserStrategyCardModel = CatalogStrategyRow & {
  monthlyFeeInr: string;
  revenueSharePercent: string;
  hasPricingOverride: boolean;
  subscriptionUx: "subscribed" | "pending_activation" | "subscribe";
};

/**
 * Query A — public, active catalog strategies.
 */
export async function listPublicActiveStrategies(): Promise<CatalogStrategyRow[]> {
  if (!db) return [];

  const rows = await db
    .select({
      id: strategies.id,
      slug: strategies.slug,
      name: strategies.name,
      description: strategies.description,
      defaultMonthlyFeeInr: strategies.defaultMonthlyFeeInr,
      defaultRevenueSharePercent: strategies.defaultRevenueSharePercent,
      riskLabel: strategies.riskLabel,
      recommendedCapitalInr: strategies.recommendedCapitalInr,
      performanceChartJson: strategies.performanceChartJson,
    })
    .from(strategies)
    .where(
      and(
        eq(strategies.visibility, "public"),
        eq(strategies.status, "active"),
        isNull(strategies.deletedAt),
      ),
    )
    .orderBy(strategies.name);

  return rows.map((r) => ({
    ...r,
    defaultMonthlyFeeInr: String(r.defaultMonthlyFeeInr),
    defaultRevenueSharePercent: String(r.defaultRevenueSharePercent),
    recommendedCapitalInr: r.recommendedCapitalInr
      ? String(r.recommendedCapitalInr)
      : null,
  }));
}

function pickLatestEffectiveOverride<
  T extends {
    strategyId: string;
    effectiveFrom: Date;
    monthlyFeeInrOverride: string | null;
    revenueSharePercentOverride: string | null;
  },
>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.strategyId)) {
      map.set(row.strategyId, row);
    }
  }
  return map;
}

/**
 * Query B — current pricing overrides for this user and strategy set.
 * Ordered by `effective_from` DESC so first row per strategy wins.
 */
export async function listEffectivePricingOverridesForUser(
  userId: string,
  strategyIds: string[],
): Promise<
  Map<
    string,
    {
      monthlyFeeInrOverride: string | null;
      revenueSharePercentOverride: string | null;
    }
  >
> {
  if (!db || strategyIds.length === 0) {
    return new Map();
  }

  const now = new Date();

  const rows = await db
    .select({
      strategyId: userStrategyPricingOverrides.strategyId,
      effectiveFrom: userStrategyPricingOverrides.effectiveFrom,
      monthlyFeeInrOverride: userStrategyPricingOverrides.monthlyFeeInrOverride,
      revenueSharePercentOverride:
        userStrategyPricingOverrides.revenueSharePercentOverride,
    })
    .from(userStrategyPricingOverrides)
    .where(
      and(
        eq(userStrategyPricingOverrides.userId, userId),
        eq(userStrategyPricingOverrides.isActive, true),
        inArray(userStrategyPricingOverrides.strategyId, strategyIds),
        lte(userStrategyPricingOverrides.effectiveFrom, now),
        or(
          isNull(userStrategyPricingOverrides.effectiveUntil),
          gt(userStrategyPricingOverrides.effectiveUntil, now),
        ),
      ),
    )
    .orderBy(desc(userStrategyPricingOverrides.effectiveFrom));

  const picked = pickLatestEffectiveOverride(rows);
  const out = new Map<
    string,
    {
      monthlyFeeInrOverride: string | null;
      revenueSharePercentOverride: string | null;
    }
  >();

  for (const [sid, row] of picked) {
    out.set(sid, {
      monthlyFeeInrOverride: row.monthlyFeeInrOverride
        ? String(row.monthlyFeeInrOverride)
        : null,
      revenueSharePercentOverride: row.revenueSharePercentOverride
        ? String(row.revenueSharePercentOverride)
        : null,
    });
  }
  return out;
}

/**
 * Query C — non-deleted subscriptions for user × strategies.
 */
export async function listUserSubscriptionsForStrategies(
  userId: string,
  strategyIds: string[],
): Promise<
  {
    strategyId: string;
    status: string;
    accessValidUntil: Date;
  }[]
> {
  if (!db || strategyIds.length === 0) {
    return [];
  }

  return db
    .select({
      strategyId: userStrategySubscriptions.strategyId,
      status: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
    })
    .from(userStrategySubscriptions)
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        inArray(userStrategySubscriptions.strategyId, strategyIds),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    );
}

export async function getUserStrategySubscriptionUx(
  userId: string,
  strategyId: string,
): Promise<"subscribed" | "pending_activation" | "subscribe"> {
  const rows = await listUserSubscriptionsForStrategies(userId, [strategyId]);
  return subscriptionUxForStrategy(rows, strategyId, new Date());
}

function subscriptionUxForStrategy(
  rows: { strategyId: string; status: string; accessValidUntil: Date }[],
  strategyId: string,
  now: Date,
): "subscribed" | "pending_activation" | "subscribe" {
  const relevant = rows.filter((r) => r.strategyId === strategyId);
  if (relevant.length === 0) return "subscribe";

  const entitled = relevant.some(
    (r) => r.status === "active" && r.accessValidUntil > now,
  );
  if (entitled) return "subscribed";

  const pending = relevant.some((r) => r.status === "purchased_pending_activation");
  if (pending) return "pending_activation";

  return "subscribe";
}

/**
 * Full catalog for `/user/strategies`: runs A, then B + C when `userId` is set.
 */
export async function getUserStrategyCatalog(
  userId: string | null,
): Promise<UserStrategyCardModel[]> {
  const catalog = await listPublicActiveStrategies();
  if (catalog.length === 0) return [];

  const ids = catalog.map((s) => s.id);
  const now = new Date();

  const [overrideMap, subRows] = userId
    ? await Promise.all([
        listEffectivePricingOverridesForUser(userId, ids),
        listUserSubscriptionsForStrategies(userId, ids),
      ])
    : [new Map<string, never>(), [] as { strategyId: string; status: string; accessValidUntil: Date }[]];

  return catalog.map((s) => {
    const merged = mergeStrategyPricing(
      {
        defaultMonthlyFeeInr: s.defaultMonthlyFeeInr,
        defaultRevenueSharePercent: s.defaultRevenueSharePercent,
      },
      userId ? overrideMap.get(s.id) : null,
    );

    const subscriptionUx = userId
      ? subscriptionUxForStrategy(subRows, s.id, now)
      : "subscribe";

    return {
      ...s,
      monthlyFeeInr: merged.monthlyFeeInr,
      revenueSharePercent: merged.revenueSharePercent,
      hasPricingOverride: merged.hasOverride,
      subscriptionUx,
    };
  });
}
