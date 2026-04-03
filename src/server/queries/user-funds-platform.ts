import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "@/server/db";
import {
  botOrders,
  payments,
  strategies,
  trades,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

import { calendarDateIST } from "./user-dashboard";

export type PlatformPaymentRow = {
  id: string;
  amountInr: string;
  status: string;
  createdAt: string;
  strategyName: string | null;
  kind: "subscription" | "other";
};

export type UserFundsPlatformSnapshot = {
  totalNetProfitInr: string;
  /** Unpaid / partial balance for the current IST calendar week row(s). */
  revenueDueThisWeekInr: string;
  /** Unpaid / partial across all open ledger rows. */
  revenueSharePendingAllInr: string;
  revenueSharePaidTotalInr: string;
};

function assertYmd(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function getUserFundsPlatformSnapshot(
  userId: string,
): Promise<UserFundsPlatformSnapshot | null> {
  if (!db) return null;
  const todayIst = calendarDateIST();

  const [botPnl, tradePnl, weekDue, paidTotal, pendingTotal] = await Promise.all([
    db
      .select({
        v: sql<string>`coalesce(sum(${botOrders.realizedPnlInr}), 0)::text`,
      })
      .from(botOrders)
      .where(
        and(
          eq(botOrders.userId, userId),
          inArray(botOrders.status, ["filled", "partial_fill"]),
        ),
      ),
    db
      .select({
        v: sql<string>`coalesce(sum(${trades.realizedPnlInr}), 0)::text`,
      })
      .from(trades)
      .where(eq(trades.userId, userId)),
    db
      .select({
        v: sql<string>`coalesce(
          sum(
            cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
            - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)
          ),
          0
        )::text`,
      })
      .from(weeklyRevenueShareLedgers)
      .where(
        and(
          eq(weeklyRevenueShareLedgers.userId, userId),
          inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
          lte(weeklyRevenueShareLedgers.weekStartDateIst, todayIst),
          gte(weeklyRevenueShareLedgers.weekEndDateIst, todayIst),
        ),
      ),
    db
      .select({
        v: sql<string>`coalesce(sum(${weeklyRevenueShareLedgers.amountPaidInr}), 0)::text`,
      })
      .from(weeklyRevenueShareLedgers)
      .where(eq(weeklyRevenueShareLedgers.userId, userId)),
    db
      .select({
        v: sql<string>`coalesce(
          sum(
            cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
            - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)
          ),
          0
        )::text`,
      })
      .from(weeklyRevenueShareLedgers)
      .where(
        and(
          eq(weeklyRevenueShareLedgers.userId, userId),
          inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
        ),
      ),
  ]);

  const b = Number(botPnl[0]?.v ?? 0);
  const t = Number(tradePnl[0]?.v ?? 0);
  const totalNet = Number.isFinite(b + t) ? String(b + t) : "0";

  return {
    totalNetProfitInr: totalNet,
    revenueDueThisWeekInr: weekDue[0]?.v ?? "0",
    revenueSharePaidTotalInr: paidTotal[0]?.v ?? "0",
    revenueSharePendingAllInr: pendingTotal[0]?.v ?? "0",
  };
}

export async function getUserPlatformPayments(
  userId: string,
  opts: {
    dateFrom?: string;
    dateTo?: string;
    payKind: "all" | "subscription";
    limit?: number;
  },
): Promise<PlatformPaymentRow[]> {
  if (!db) return [];
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);

  const conds = [
    eq(payments.userId, userId),
    eq(payments.status, "success"),
  ];

  if (opts.payKind === "subscription") {
    conds.push(isNotNull(payments.strategyId));
  }

  if (assertYmd(opts.dateFrom)) {
    conds.push(
      sql`(timezone('Asia/Kolkata', ${payments.createdAt}))::date >= ${opts.dateFrom}::date`,
    );
  }
  if (assertYmd(opts.dateTo)) {
    conds.push(
      sql`(timezone('Asia/Kolkata', ${payments.createdAt}))::date <= ${opts.dateTo}::date`,
    );
  }

  const rows = await db
    .select({
      id: payments.id,
      amountInr: payments.amountInr,
      status: payments.status,
      createdAt: payments.createdAt,
      strategyName: strategies.name,
      strategyId: payments.strategyId,
    })
    .from(payments)
    .leftJoin(strategies, eq(payments.strategyId, strategies.id))
    .where(and(...conds))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    amountInr: String(r.amountInr),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    strategyName: r.strategyName,
    kind: r.strategyId ? ("subscription" as const) : ("other" as const),
  }));
}

export type RevenueLedgerRow = {
  id: string;
  weekStart: string;
  weekEnd: string;
  amountDueInr: string;
  amountPaidInr: string;
  status: string;
  dueAt: string;
};

export async function getUserRecentRevenueLedgers(
  userId: string,
  limit = 8,
): Promise<RevenueLedgerRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: weeklyRevenueShareLedgers.id,
      weekStart: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEnd: weeklyRevenueShareLedgers.weekEndDateIst,
      amountDueInr: weeklyRevenueShareLedgers.amountDueInr,
      amountPaidInr: weeklyRevenueShareLedgers.amountPaidInr,
      status: weeklyRevenueShareLedgers.status,
      dueAt: weeklyRevenueShareLedgers.dueAt,
    })
    .from(weeklyRevenueShareLedgers)
    .where(eq(weeklyRevenueShareLedgers.userId, userId))
    .orderBy(desc(weeklyRevenueShareLedgers.dueAt))
    .limit(Math.min(limit, 24));

  return rows.map((r) => ({
    id: r.id,
    weekStart: String(r.weekStart),
    weekEnd: String(r.weekEnd),
    amountDueInr: String(r.amountDueInr),
    amountPaidInr: String(r.amountPaidInr),
    status: r.status,
    dueAt: r.dueAt.toISOString(),
  }));
}
