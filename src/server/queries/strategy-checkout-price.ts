import { and, desc, eq, isNull } from "drizzle-orm";

import { mergeStrategyPricing } from "@/lib/user-strategy-pricing";
import { db } from "@/server/db";
import { strategies, userStrategySubscriptions } from "@/server/db/schema";

import { listEffectivePricingOverridesForUser } from "./user-strategy-catalog";

export type StrategyCheckoutQuote = {
  strategyId: string;
  slug: string;
  name: string;
  monthlyFeeInr: string;
  revenueSharePercent: string;
  hasPricingOverride: boolean;
};

const MS_PER_DAY = 86_400_000;

export type StrategyCheckoutRenewalForecast = {
  accessDaysAdded: number;
  /** UTC instant if payment succeeds; show in IST in UI only. */
  projectedAccessValidUntil: Date;
  /** Existing subscription row → stacking on same id at webhook; otherwise first insert. */
  isRenewal: boolean;
  currentAccessValidUntil: Date | null;
};

/**
 * Projected `access_valid_until` after a successful payment, using the same
 * anchor rule as `fulfillStrategyPaymentFromWebhook` (must stay in sync).
 */
export async function getStrategyCheckoutRenewalForecast(
  userId: string,
  strategyId: string,
  accessDaysPurchased: number = 30,
): Promise<StrategyCheckoutRenewalForecast | null> {
  if (!db) return null;

  const now = new Date();
  const extendMs = accessDaysPurchased * MS_PER_DAY;

  const [latestSub] = await db
    .select({
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
    })
    .from(userStrategySubscriptions)
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        eq(userStrategySubscriptions.strategyId, strategyId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .orderBy(desc(userStrategySubscriptions.createdAt))
    .limit(1);

  if (!latestSub) {
    return {
      accessDaysAdded: accessDaysPurchased,
      projectedAccessValidUntil: new Date(now.getTime() + extendMs),
      isRenewal: false,
      currentAccessValidUntil: null,
    };
  }

  const anchorMs = Math.max(
    now.getTime(),
    latestSub.accessValidUntil.getTime(),
  );
  return {
    accessDaysAdded: accessDaysPurchased,
    projectedAccessValidUntil: new Date(anchorMs + extendMs),
    isRenewal: true,
    currentAccessValidUntil: latestSub.accessValidUntil,
  };
}

/**
 * Server-side price for Cashfree: strategy row + effective override merge (same rules as catalog).
 */
export async function resolveStrategyCheckoutQuote(
  userId: string,
  strategySlug: string,
): Promise<StrategyCheckoutQuote | null> {
  if (!db) return null;

  const [strat] = await db
    .select({
      id: strategies.id,
      slug: strategies.slug,
      name: strategies.name,
      defaultMonthlyFeeInr: strategies.defaultMonthlyFeeInr,
      defaultRevenueSharePercent: strategies.defaultRevenueSharePercent,
    })
    .from(strategies)
    .where(
      and(
        eq(strategies.slug, strategySlug),
        eq(strategies.visibility, "public"),
        eq(strategies.status, "active"),
        isNull(strategies.deletedAt),
      ),
    )
    .limit(1);

  if (!strat) return null;

  const overrideMap = await listEffectivePricingOverridesForUser(userId, [
    strat.id,
  ]);
  const merged = mergeStrategyPricing(
    {
      defaultMonthlyFeeInr: String(strat.defaultMonthlyFeeInr),
      defaultRevenueSharePercent: String(strat.defaultRevenueSharePercent),
    },
    overrideMap.get(strat.id) ?? null,
  );

  return {
    strategyId: strat.id,
    slug: strat.slug,
    name: strat.name,
    monthlyFeeInr: merged.monthlyFeeInr,
    revenueSharePercent: merged.revenueSharePercent,
    hasPricingOverride: merged.hasOverride,
  };
}
