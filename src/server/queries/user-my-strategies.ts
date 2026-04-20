import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { mergeStrategyPricing } from "@/lib/user-strategy-pricing";
import { db } from "@/server/db";
import {
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";

import { listEffectivePricingOverridesForUser } from "./user-strategy-catalog";

/** Accepts Drizzle `Date` or serialized string timestamps without throwing. */
function coerceValidDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

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
        ne(userStrategySubscriptions.status, "cancelled"),
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

    const accessEnd = coerceValidDate(sub.accessValidUntil);
    if (!accessEnd) continue;
    const accessOk = accessEnd.getTime() > now.getTime();
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
        ne(userStrategySubscriptions.status, "cancelled"),
      ),
    )
    .orderBy(strategies.name);

  const strategyIds = [...new Set(rows.map((r) => r.strategyId))];
  const overrides = await listEffectivePricingOverridesForUser(
    userId,
    strategyIds,
  );

  const mapped: MyStrategyRow[] = [];

  for (const r of rows) {
    if (
      !r.subscriptionId ||
      !r.strategyId ||
      typeof r.slug !== "string" ||
      !r.slug.trim() ||
      typeof r.name !== "string" ||
      !r.name.trim()
    ) {
      continue;
    }

    const accessValidUntil = coerceValidDate(r.accessValidUntil);
    const purchasedAt = coerceValidDate(r.purchasedAt);
    if (accessValidUntil == null || purchasedAt == null) {
      continue;
    }

    const defaultFee = r.defaultMonthlyFeeInr;
    const defaultRev = r.defaultRevenueSharePercent;
    if (defaultFee == null || defaultRev == null) {
      continue;
    }

    const ov = overrides.get(r.strategyId);
    const merged = mergeStrategyPricing(
      {
        defaultMonthlyFeeInr: String(defaultFee),
        defaultRevenueSharePercent: String(defaultRev),
      },
      ov ?? null,
    );

    mapped.push({
      subscriptionId: r.subscriptionId,
      strategyId: r.strategyId,
      slug: r.slug,
      name: r.name,
      description: r.description,
      strategyStatus: r.strategyStatus,
      subscriptionStatus: r.subscriptionStatus,
      accessValidUntil,
      purchasedAt,
      runStatus: r.runStatus,
      capitalToUseInr: r.capitalToUseInr ? String(r.capitalToUseInr) : null,
      leverage: r.leverage ? String(r.leverage) : null,
      monthlyFeeInr: merged.monthlyFeeInr,
      revenueSharePercent: merged.revenueSharePercent,
      hasPricingOverride: merged.hasOverride,
    });
  }

  return mapped;
}
