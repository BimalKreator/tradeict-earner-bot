import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
  sum,
} from "drizzle-orm";

import { db } from "@/server/db";
import {
  exchangeConnections,
  payments,
  strategies,
  userStrategyPricingOverrides,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type AdminUserExchangeRow = {
  id: string;
  provider: string;
  status: string;
  lastTestStatus: string;
  lastTestAt: Date | null;
  lastTestMessage: string | null;
  updatedAt: Date;
  hasStoredCredentials: boolean;
};

export type AdminUserStrategyRow = {
  subscriptionId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  subscriptionStatus: string;
  accessValidUntil: Date;
  runId: string | null;
  runStatus: string | null;
  /** True when this user has a live (active + in-window) pricing override for this strategy. */
  hasCustomPricing: boolean;
};

export type AdminUserProfileDetail = {
  user: {
    id: string;
    email: string;
    name: string | null;
    address: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    approvalStatus: string;
    approvalNotes: string | null;
    adminInternalNotes: string | null;
    approvedAt: Date | null;
    approvedByAdminId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  exchangeConnections: AdminUserExchangeRow[];
  activeStrategies: AdminUserStrategyRow[];
  inactiveStrategies: AdminUserStrategyRow[];
  revenueDueInr: string;
  paymentsSuccessTotalInr: string;
};

export async function getAdminUserProfile(
  userId: string,
): Promise<AdminUserProfileDetail | null> {
  if (!db) return null;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      address: users.address,
      phone: users.phone,
      whatsappNumber: users.whatsappNumber,
      approvalStatus: users.approvalStatus,
      approvalNotes: users.approvalNotes,
      adminInternalNotes: users.adminInternalNotes,
      approvedAt: users.approvedAt,
      approvedByAdminId: users.approvedByAdminId,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) return null;

  const now = new Date();

  const [
    exchangeRows,
    subRows,
    dueRow,
    payRow,
    liveOverrideStrategies,
  ] = await Promise.all([
    db
      .select({
        id: exchangeConnections.id,
        provider: exchangeConnections.provider,
        status: exchangeConnections.status,
        lastTestStatus: exchangeConnections.lastTestStatus,
        lastTestAt: exchangeConnections.lastTestAt,
        lastTestMessage: exchangeConnections.lastTestMessage,
        updatedAt: exchangeConnections.updatedAt,
        hasStoredCredentials: sql<boolean>`(
          length(trim(coalesce(${exchangeConnections.apiKeyCiphertext}, ''))) > 0
          and length(trim(coalesce(${exchangeConnections.apiSecretCiphertext}, ''))) > 0
        )`,
      })
      .from(exchangeConnections)
      .where(
        and(
          eq(exchangeConnections.userId, userId),
          isNull(exchangeConnections.deletedAt),
        ),
      ),
    db
      .select({
        subscriptionId: userStrategySubscriptions.id,
        strategyId: strategies.id,
        strategyName: strategies.name,
        strategySlug: strategies.slug,
        subscriptionStatus: userStrategySubscriptions.status,
        accessValidUntil: userStrategySubscriptions.accessValidUntil,
        runId: userStrategyRuns.id,
        runStatus: userStrategyRuns.status,
      })
      .from(userStrategySubscriptions)
      .innerJoin(
        strategies,
        eq(strategies.id, userStrategySubscriptions.strategyId),
      )
      .leftJoin(
        userStrategyRuns,
        eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
      )
      .where(
        and(
          eq(userStrategySubscriptions.userId, userId),
          isNull(userStrategySubscriptions.deletedAt),
        ),
      ),
    db
      .select({
        v: sql<string>`coalesce(
          sum(
            cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
            - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)
          ),
          0
        )::text`.as("due"),
      })
      .from(weeklyRevenueShareLedgers)
      .where(
        and(
          eq(weeklyRevenueShareLedgers.userId, userId),
          inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
        ),
      ),
    db
      .select({ v: sum(payments.amountInr) })
      .from(payments)
      .where(
        and(eq(payments.userId, userId), eq(payments.status, "success")),
      ),
    db
      .select({
        strategyId: userStrategyPricingOverrides.strategyId,
      })
      .from(userStrategyPricingOverrides)
      .where(
        and(
          eq(userStrategyPricingOverrides.userId, userId),
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

  const livePricingStrategyIds = new Set(
    liveOverrideStrategies.map((r) => r.strategyId),
  );

  const activeStrategies: AdminUserStrategyRow[] = [];
  const inactiveStrategies: AdminUserStrategyRow[] = [];

  for (const r of subRows) {
    const row: AdminUserStrategyRow = {
      subscriptionId: r.subscriptionId,
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      strategySlug: r.strategySlug,
      subscriptionStatus: r.subscriptionStatus,
      accessValidUntil: r.accessValidUntil,
      runId: r.runId,
      runStatus: r.runStatus,
      hasCustomPricing: livePricingStrategyIds.has(r.strategyId),
    };
    const entitled =
      r.subscriptionStatus === "active" && r.accessValidUntil > now;
    const running = r.runStatus === "active";
    if (entitled && running) {
      activeStrategies.push(row);
    } else {
      inactiveStrategies.push(row);
    }
  }

  return {
    user,
    exchangeConnections: exchangeRows.map((c) => ({
      ...c,
      hasStoredCredentials: Boolean(c.hasStoredCredentials),
    })),
    activeStrategies,
    inactiveStrategies,
    revenueDueInr: dueRow[0]?.v ?? "0",
    paymentsSuccessTotalInr: payRow[0]?.v ?? "0",
  };
}
