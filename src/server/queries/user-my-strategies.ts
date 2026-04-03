import { and, eq, inArray, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { mergeStrategyPricing } from "@/lib/user-strategy-pricing";
import { db } from "@/server/db";
import {
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";

import { listEffectivePricingOverridesForUser } from "./user-strategy-catalog";

export type MyStrategySubscriptionStatus =
  InferSelectModel<typeof userStrategySubscriptions>["status"];

export type MyStrategyRunStatus = InferSelectModel<
  typeof userStrategyRuns
>["status"];

export type MyStrategyRow = {
  subscriptionId: string;
  strategyId: string;
  slug: string;
  name: string;
  description: string | null;
  strategyStatus: InferSelectModel<typeof strategies>["status"];
  subscriptionStatus: MyStrategySubscriptionStatus;
  accessValidUntil: Date;
  purchasedAt: Date;
  runStatus: MyStrategyRunStatus;
  capitalToUseInr: string | null;
  leverage: string | null;
  monthlyFeeInr: string;
  revenueSharePercent: string;
  hasPricingOverride: boolean;
};

/**
 * Inserts a missing `user_strategy_runs` row for each non-deleted subscription.
 * Entitled active window → `ready_to_activate`; otherwise `expired` on the run row.
 */
export async function ensureMissingStrategyRunsForUser(
  userId: string,
): Promise<void> {
  if (!db) return;

  const subs = await db
    .select({
      id: userStrategySubscriptions.id,
      status: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
    })
    .from(userStrategySubscriptions)
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    );

  if (subs.length === 0) return;

  const subIds = subs.map((s) => s.id);
  const existing = await db
    .select({ subscriptionId: userStrategyRuns.subscriptionId })
    .from(userStrategyRuns)
    .where(inArray(userStrategyRuns.subscriptionId, subIds));

  const have = new Set(existing.map((e) => e.subscriptionId));
  const now = new Date();

  for (const sub of subs) {
    if (have.has(sub.id)) continue;

    const accessOk = sub.accessValidUntil.getTime() > now.getTime();
    const terminal =
      sub.status === "expired" || sub.status === "cancelled" || !accessOk;
    const runStatus = terminal ? "expired" : "ready_to_activate";

    await db
      .insert(userStrategyRuns)
      .values({
        subscriptionId: sub.id,
        status: runStatus,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: userStrategyRuns.subscriptionId });
  }
}

export async function listMyStrategiesForUser(
  userId: string,
): Promise<MyStrategyRow[]> {
  if (!db) return [];

  await ensureMissingStrategyRunsForUser(userId);

  const rows = await db
    .select({
      subscriptionId: userStrategySubscriptions.id,
      strategyId: strategies.id,
      slug: strategies.slug,
      name: strategies.name,
      description: strategies.description,
      strategyStatus: strategies.status,
      defaultMonthlyFeeInr: strategies.defaultMonthlyFeeInr,
      defaultRevenueSharePercent: strategies.defaultRevenueSharePercent,
      subscriptionStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      purchasedAt: userStrategySubscriptions.purchasedAt,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .orderBy(strategies.name);

  const strategyIds = [...new Set(rows.map((r) => r.strategyId))];
  const overrides = await listEffectivePricingOverridesForUser(
    userId,
    strategyIds,
  );

  return rows.map((r) => {
    const ov = overrides.get(r.strategyId);
    const merged = mergeStrategyPricing(
      {
        defaultMonthlyFeeInr: String(r.defaultMonthlyFeeInr),
        defaultRevenueSharePercent: String(r.defaultRevenueSharePercent),
      },
      ov ?? null,
    );
    return {
      subscriptionId: r.subscriptionId,
      strategyId: r.strategyId,
      slug: r.slug,
      name: r.name,
      description: r.description,
      strategyStatus: r.strategyStatus,
      subscriptionStatus: r.subscriptionStatus,
      accessValidUntil: r.accessValidUntil,
      purchasedAt: r.purchasedAt,
      runStatus: r.runStatus,
      capitalToUseInr: r.capitalToUseInr ? String(r.capitalToUseInr) : null,
      leverage: r.leverage ? String(r.leverage) : null,
      monthlyFeeInr: merged.monthlyFeeInr,
      revenueSharePercent: merged.revenueSharePercent,
      hasPricingOverride: merged.hasOverride,
    };
  });
}
