import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNull,
  sql,
  sum,
} from "drizzle-orm";

import { db } from "@/server/db";
import {
  payments,
  strategies,
  users,
  userStrategySubscriptions,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type AdminDashboardMetrics = {
  totalUsers: number;
  pendingApprovals: number;
  approvedUsers: number;
  totalStrategies: number;
  activeSubscriptions: number;
  weeklyDueInr: string;
  totalCollectedRevenueInr: string;
};

const zeroMetrics: AdminDashboardMetrics = {
  totalUsers: 0,
  pendingApprovals: 0,
  approvedUsers: 0,
  totalStrategies: 0,
  activeSubscriptions: 0,
  weeklyDueInr: "0",
  totalCollectedRevenueInr: "0",
};

function formatDecimal(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0";
  return v;
}

/**
 * Aggregations for the admin dashboard. Returns zeros when DATABASE_URL is unset.
 */
export async function getAdminDashboardMetrics(): Promise<AdminDashboardMetrics> {
  if (!db) {
    return zeroMetrics;
  }

  const now = new Date();

  const [
    totalUsersRow,
    pendingRow,
    approvedRow,
    strategiesRow,
    subsRow,
    dueRow,
    revenueRow,
  ] = await Promise.all([
    db
      .select({ c: count() })
      .from(users)
      .where(isNull(users.deletedAt)),
    db
      .select({ c: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.approvalStatus, "pending_approval"),
        ),
      ),
    db
      .select({ c: count() })
      .from(users)
      .where(
        and(isNull(users.deletedAt), eq(users.approvalStatus, "approved")),
      ),
    db
      .select({ c: count() })
      .from(strategies)
      .where(isNull(strategies.deletedAt)),
    db
      .select({ c: count() })
      .from(userStrategySubscriptions)
      .where(
        and(
          isNull(userStrategySubscriptions.deletedAt),
          eq(userStrategySubscriptions.status, "active"),
          gt(userStrategySubscriptions.accessValidUntil, now),
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
        )::text`.as("weekly_due"),
      })
      .from(weeklyRevenueShareLedgers)
      .where(
        inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
      ),
    db
      .select({
        v: sum(payments.amountInr),
      })
      .from(payments)
      .where(eq(payments.status, "success")),
  ]);

  return {
    totalUsers: Number(totalUsersRow[0]?.c ?? 0),
    pendingApprovals: Number(pendingRow[0]?.c ?? 0),
    approvedUsers: Number(approvedRow[0]?.c ?? 0),
    totalStrategies: Number(strategiesRow[0]?.c ?? 0),
    activeSubscriptions: Number(subsRow[0]?.c ?? 0),
    weeklyDueInr: formatDecimal(dueRow[0]?.v),
    totalCollectedRevenueInr: formatDecimal(revenueRow[0]?.v),
  };
}
