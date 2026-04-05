import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/server/db";
import { strategies, userStrategyPricingOverrides, users } from "@/server/db/schema";

export type AdminPricingStrategyOption = {
  id: string;
  name: string;
  slug: string;
};

export type AdminUserPricingOverrideListRow = {
  id: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  monthlyFeeInrOverride: string | null;
  revenueSharePercentOverride: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  isActive: boolean;
  adminNotes: string | null;
  createdAt: Date;
};

export async function listStrategiesForPricingOverridePicker(): Promise<
  AdminPricingStrategyOption[]
> {
  if (!db) return [];

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      slug: strategies.slug,
    })
    .from(strategies)
    .where(
      and(eq(strategies.status, "active"), isNull(strategies.deletedAt)),
    )
    .orderBy(strategies.name);

  return rows;
}

export async function listAdminUserPricingOverrides(
  userId: string,
): Promise<AdminUserPricingOverrideListRow[]> {
  if (!db) return [];

  const rows = await db
    .select({
      id: userStrategyPricingOverrides.id,
      strategyId: userStrategyPricingOverrides.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      monthlyFeeInrOverride: userStrategyPricingOverrides.monthlyFeeInrOverride,
      revenueSharePercentOverride:
        userStrategyPricingOverrides.revenueSharePercentOverride,
      effectiveFrom: userStrategyPricingOverrides.effectiveFrom,
      effectiveUntil: userStrategyPricingOverrides.effectiveUntil,
      isActive: userStrategyPricingOverrides.isActive,
      adminNotes: userStrategyPricingOverrides.adminNotes,
      createdAt: userStrategyPricingOverrides.createdAt,
    })
    .from(userStrategyPricingOverrides)
    .innerJoin(
      strategies,
      eq(strategies.id, userStrategyPricingOverrides.strategyId),
    )
    .where(eq(userStrategyPricingOverrides.userId, userId))
    .orderBy(desc(userStrategyPricingOverrides.effectiveFrom));

  return rows.map((r) => ({
    id: r.id,
    strategyId: r.strategyId,
    strategyName: r.strategyName ?? "—",
    strategySlug: r.strategySlug,
    monthlyFeeInrOverride:
      r.monthlyFeeInrOverride != null
        ? String(r.monthlyFeeInrOverride)
        : null,
    revenueSharePercentOverride:
      r.revenueSharePercentOverride != null
        ? String(r.revenueSharePercentOverride)
        : null,
    effectiveFrom: r.effectiveFrom,
    effectiveUntil: r.effectiveUntil,
    isActive: r.isActive,
    adminNotes: r.adminNotes,
    createdAt: r.createdAt,
  }));
}

export async function getAdminUserPricingPageContext(userId: string): Promise<{
  email: string;
} | null> {
  if (!db) return null;
  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return null;
  return { email: u.email };
}
