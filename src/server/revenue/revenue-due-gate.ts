/**
 * Automatic billing block: transition runs to `blocked_revenue_due` when weekly
 * ledger balances are overdue (with optional grace). Release helper for the
 * future “pay revenue share” flow.
 */

import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  auditLogs,
  userStrategyRuns,
  userStrategySubscriptions,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

/** Hours after `due_at` before we block new entries (0 = block once due_at has passed). */
export function revenueShareBlockDueCutoff(): Date {
  const graceH = Math.max(
    0,
    Number(process.env.REVENUE_SHARE_BLOCK_GRACE_HOURS ?? 0) || 0,
  );
  return new Date(Date.now() - graceH * 3_600_000);
}

/**
 * True when this subscription still has a ledger row that should keep the bot
 * in a revenue block (unpaid balance + past effective due including grace).
 */
export async function subscriptionHasBlockingOverdueLedger(
  subscriptionId: string,
): Promise<boolean> {
  if (!db) return false;
  const cutoff = revenueShareBlockDueCutoff();
  const [hit] = await db
    .select({ id: weeklyRevenueShareLedgers.id })
    .from(weeklyRevenueShareLedgers)
    .where(
      and(
        eq(weeklyRevenueShareLedgers.subscriptionId, subscriptionId),
        inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
        sql`(cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric) - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)) > 0`,
        lte(weeklyRevenueShareLedgers.dueAt, cutoff),
      ),
    )
    .limit(1);
  return !!hit;
}

export type EnforceRevenueBlocksResult = {
  blockedRunIds: string[];
};

/**
 * Sets `active` → `blocked_revenue_due` when an overdue unpaid ledger exists for
 * the subscription. Idempotent for already-blocked runs (they are not `active`).
 */
export async function enforceRevenueDueBlocks(): Promise<EnforceRevenueBlocksResult> {
  if (!db) return { blockedRunIds: [] };

  const cutoff = revenueShareBlockDueCutoff();

  const overdueSubs = await db
    .selectDistinct({
      subscriptionId: weeklyRevenueShareLedgers.subscriptionId,
    })
    .from(weeklyRevenueShareLedgers)
    .where(
      and(
        inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
        sql`(cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric) - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)) > 0`,
        lte(weeklyRevenueShareLedgers.dueAt, cutoff),
      ),
    );

  const subIds = overdueSubs.map((r) => r.subscriptionId);
  if (subIds.length === 0) return { blockedRunIds: [] };

  const runs = await db
    .select({
      id: userStrategyRuns.id,
      subscriptionId: userStrategyRuns.subscriptionId,
      userId: userStrategySubscriptions.userId,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategyRuns.status, "active"),
        inArray(userStrategyRuns.subscriptionId, subIds),
      ),
    );

  const ids = runs.map((r) => r.id);
  if (ids.length === 0) return { blockedRunIds: [] };

  await db
    .update(userStrategyRuns)
    .set({
      status: "blocked_revenue_due",
      lastStateReason: "auto_blocked_overdue_revenue_share",
      updatedAt: new Date(),
    })
    .where(inArray(userStrategyRuns.id, ids));

  for (const r of runs) {
    await db.insert(auditLogs).values({
      actorType: "system",
      action: "revenue_share_auto_block",
      entityType: "user_strategy_run",
      entityId: r.id,
      actorUserId: r.userId,
      metadata: {
        subscription_id: r.subscriptionId,
        due_cutoff_utc: cutoff.toISOString(),
      },
    });
  }

  return { blockedRunIds: ids };
}

export type ReleaseRevenueBlockResult = {
  releasedRunIds: string[];
};

/**
 * Call after successful revenue-share settlement: any run stuck in
 * `blocked_revenue_due` for this user is moved back to `active` when no overdue
 * blocking ledger remains for that subscription.
 */
export async function releaseRevenueBlock(
  userId: string,
): Promise<ReleaseRevenueBlockResult> {
  if (!db) return { releasedRunIds: [] };

  const blocked = await db
    .select({
      id: userStrategyRuns.id,
      subscriptionId: userStrategyRuns.subscriptionId,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        eq(userStrategyRuns.status, "blocked_revenue_due"),
      ),
    );

  const released: string[] = [];

  for (const row of blocked) {
    const stillBlocked = await subscriptionHasBlockingOverdueLedger(
      row.subscriptionId,
    );
    if (stillBlocked) continue;

    await db
      .update(userStrategyRuns)
      .set({
        status: "active",
        lastStateReason: null,
        updatedAt: new Date(),
      })
      .where(eq(userStrategyRuns.id, row.id));

    await db.insert(auditLogs).values({
      actorType: "system",
      action: "resumed_after_payment",
      entityType: "user_strategy_run",
      entityId: row.id,
      actorUserId: userId,
      metadata: {
        from: "blocked_revenue_due",
        to: "active",
      },
    });

    released.push(row.id);
  }

  return { releasedRunIds: released };
}
