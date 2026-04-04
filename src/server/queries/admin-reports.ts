import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  botOrders,
  feeWaivers,
  payments,
  strategies,
  users,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type AdminPlatformRevenueSummary = {
  totalSuccessInr: string;
  subscriptionFeesInr: string;
  revenueShareFeesInr: string;
  paymentCount: number;
};

export type AdminStrategyRevenueRow = {
  strategyId: string;
  strategyName: string;
  totalInr: string;
  paymentCount: number;
};

export type AdminUserRevenueRow = {
  userId: string;
  email: string;
  name: string | null;
  totalInr: string;
  paymentCount: number;
};

export type AdminTopStrategyPnlRow = {
  strategyId: string;
  strategyName: string;
  pnlInr: string;
  fillsCount: number;
};

export type AdminTopUserPnlRow = {
  userId: string;
  email: string;
  pnlInr: string;
  fillsCount: number;
};

export type AdminUnpaidDueRow = {
  ledgerId: string;
  userId: string;
  userEmail: string;
  strategyName: string;
  weekStartIst: string;
  weekEndIst: string;
  amountDueInr: string;
  amountPaidInr: string;
  outstandingInr: string;
  dueAt: Date;
  status: string;
};

export type AdminWaiverReportRow = {
  id: string;
  createdAt: Date;
  userEmail: string;
  strategyName: string | null;
  amountInr: string | null;
  reason: string;
  weekStartIst: string | null;
  ledgerId: string | null;
};

export type AdminCollectionWeekRow = {
  weekStartIst: string;
  dueInr: string;
  paidInr: string;
  waivedInr: string;
  /** Paid + explicit waiver amounts / due, 0–100. */
  efficiencyPct: string;
  ledgerCount: number;
};

export async function getAdminPlatformRevenueSummary(): Promise<AdminPlatformRevenueSummary | null> {
  if (!db) return null;
  const [row] = await db
    .select({
      totalSuccessInr: sql<string>`coalesce(sum(case when ${payments.status} = 'success' then cast(${payments.amountInr} as numeric) end), 0)::text`,
      subscriptionFeesInr: sql<string>`coalesce(sum(case when ${payments.status} = 'success' and ${payments.revenueShareLedgerId} is null then cast(${payments.amountInr} as numeric) end), 0)::text`,
      revenueShareFeesInr: sql<string>`coalesce(sum(case when ${payments.status} = 'success' and ${payments.revenueShareLedgerId} is not null then cast(${payments.amountInr} as numeric) end), 0)::text`,
      paymentCount: sql<number>`count(*) filter (where ${payments.status} = 'success')::int`,
    })
    .from(payments);

  return {
    totalSuccessInr: row?.totalSuccessInr ?? "0",
    subscriptionFeesInr: row?.subscriptionFeesInr ?? "0",
    revenueShareFeesInr: row?.revenueShareFeesInr ?? "0",
    paymentCount: row?.paymentCount ?? 0,
  };
}

export async function getAdminStrategyRevenueRows(
  limit = 40,
): Promise<AdminStrategyRevenueRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      strategyId: strategies.id,
      strategyName: strategies.name,
      totalInr: sql<string>`coalesce(sum(cast(${payments.amountInr} as numeric)), 0)::text`,
      paymentCount: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(strategies, eq(payments.strategyId, strategies.id))
    .where(
      and(eq(payments.status, "success"), isNotNull(payments.strategyId)),
    )
    .groupBy(strategies.id, strategies.name)
    .orderBy(sql`coalesce(sum(cast(${payments.amountInr} as numeric)), 0) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    totalInr: r.totalInr,
    paymentCount: r.paymentCount,
  }));
}

export async function getAdminUserRevenueRows(
  limit = 50,
): Promise<AdminUserRevenueRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      totalInr: sql<string>`coalesce(sum(cast(${payments.amountInr} as numeric)), 0)::text`,
      paymentCount: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(users, eq(payments.userId, users.id))
    .where(eq(payments.status, "success"))
    .groupBy(users.id, users.email, users.name)
    .orderBy(sql`coalesce(sum(cast(${payments.amountInr} as numeric)), 0) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    totalInr: r.totalInr,
    paymentCount: r.paymentCount,
  }));
}

export async function getAdminTopStrategiesByPnl(
  limit = 15,
): Promise<AdminTopStrategyPnlRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      strategyId: strategies.id,
      strategyName: strategies.name,
      pnlInr: sql<string>`coalesce(sum(${botOrders.realizedPnlInr}), 0)::text`,
      fillsCount: sql<number>`count(${botOrders.id})::int`,
    })
    .from(botOrders)
    .innerJoin(strategies, eq(botOrders.strategyId, strategies.id))
    .where(
      and(
        eq(botOrders.tradeSource, "bot"),
        inArray(botOrders.status, ["filled", "partial_fill"]),
      ),
    )
    .groupBy(strategies.id, strategies.name)
    .orderBy(sql`coalesce(sum(${botOrders.realizedPnlInr}), 0) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    pnlInr: r.pnlInr,
    fillsCount: r.fillsCount,
  }));
}

export async function getAdminTopUsersByPnl(
  limit = 15,
): Promise<AdminTopUserPnlRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      pnlInr: sql<string>`coalesce(sum(${botOrders.realizedPnlInr}), 0)::text`,
      fillsCount: sql<number>`count(${botOrders.id})::int`,
    })
    .from(botOrders)
    .innerJoin(users, eq(botOrders.userId, users.id))
    .where(
      and(
        eq(botOrders.tradeSource, "bot"),
        inArray(botOrders.status, ["filled", "partial_fill"]),
      ),
    )
    .groupBy(users.id, users.email)
    .orderBy(sql`coalesce(sum(${botOrders.realizedPnlInr}), 0) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    pnlInr: r.pnlInr,
    fillsCount: r.fillsCount,
  }));
}

export async function getAdminUnpaidDuesReport(
  limit = 100,
): Promise<AdminUnpaidDueRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      ledgerId: weeklyRevenueShareLedgers.id,
      userId: weeklyRevenueShareLedgers.userId,
      userEmail: users.email,
      strategyName: strategies.name,
      weekStartIst: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEndIst: weeklyRevenueShareLedgers.weekEndDateIst,
      amountDueInr: weeklyRevenueShareLedgers.amountDueInr,
      amountPaidInr: weeklyRevenueShareLedgers.amountPaidInr,
      outstandingInr: sql<string>`GREATEST(
        cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
        - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric),
        0
      )::text`,
      dueAt: weeklyRevenueShareLedgers.dueAt,
      status: weeklyRevenueShareLedgers.status,
    })
    .from(weeklyRevenueShareLedgers)
    .innerJoin(users, eq(weeklyRevenueShareLedgers.userId, users.id))
    .innerJoin(
      strategies,
      eq(weeklyRevenueShareLedgers.strategyId, strategies.id),
    )
    .where(inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]))
    .orderBy(weeklyRevenueShareLedgers.dueAt)
    .limit(limit);

  return rows.map((r) => ({
    ledgerId: r.ledgerId,
    userId: r.userId,
    userEmail: r.userEmail,
    strategyName: r.strategyName,
    weekStartIst: String(r.weekStartIst),
    weekEndIst: String(r.weekEndIst),
    amountDueInr: String(r.amountDueInr),
    amountPaidInr: String(r.amountPaidInr),
    outstandingInr: r.outstandingInr,
    dueAt: r.dueAt,
    status: r.status,
  }));
}

export async function getAdminWaiverReport(
  limit = 150,
): Promise<AdminWaiverReportRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: feeWaivers.id,
      createdAt: feeWaivers.createdAt,
      userEmail: users.email,
      strategyName: strategies.name,
      amountInr: feeWaivers.amountInr,
      reason: feeWaivers.reason,
      weekStartIst: weeklyRevenueShareLedgers.weekStartDateIst,
      ledgerId: feeWaivers.revenueLedgerId,
    })
    .from(feeWaivers)
    .innerJoin(users, eq(feeWaivers.userId, users.id))
    .leftJoin(strategies, eq(feeWaivers.strategyId, strategies.id))
    .leftJoin(
      weeklyRevenueShareLedgers,
      eq(feeWaivers.revenueLedgerId, weeklyRevenueShareLedgers.id),
    )
    .orderBy(desc(feeWaivers.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    userEmail: r.userEmail,
    strategyName: r.strategyName,
    amountInr: r.amountInr != null ? String(r.amountInr) : null,
    reason: r.reason,
    weekStartIst: r.weekStartIst != null ? String(r.weekStartIst) : null,
    ledgerId: r.ledgerId,
  }));
}

/** Per IST revenue week: collection efficiency = (paid + waivers) / due. */
export async function getAdminCollectionEfficiencyByWeek(
  weekCount = 16,
): Promise<AdminCollectionWeekRow[]> {
  if (!db) return [];
  const n = Math.min(Math.max(weekCount, 4), 52);

  const result = await db.execute(sql`
    WITH weeks AS (
      SELECT DISTINCT week_start_date_ist AS w
      FROM weekly_revenue_share_ledgers
      ORDER BY w DESC
      LIMIT ${n}
    ),
    agg AS (
      SELECT
        l.week_start_date_ist AS week_start,
        SUM(cast(l.amount_due_inr AS numeric)) AS due_sum,
        SUM(cast(l.amount_paid_inr AS numeric)) AS paid_sum,
        COUNT(*)::int AS ledger_count
      FROM weekly_revenue_share_ledgers l
      INNER JOIN weeks ON weeks.w = l.week_start_date_ist
      GROUP BY l.week_start_date_ist
    ),
    wa AS (
      SELECT
        l.week_start_date_ist AS week_start,
        COALESCE(SUM(cast(fw.amount_inr AS numeric)), 0) AS waiver_sum
      FROM fee_waivers fw
      INNER JOIN weekly_revenue_share_ledgers l ON l.id = fw.revenue_ledger_id
      INNER JOIN weeks ON weeks.w = l.week_start_date_ist
      WHERE fw.amount_inr IS NOT NULL
      GROUP BY l.week_start_date_ist
    )
    SELECT
      agg.week_start::text AS "weekStartIst",
      agg.due_sum::text AS "dueInr",
      agg.paid_sum::text AS "paidInr",
      COALESCE(wa.waiver_sum, 0)::text AS "waivedInr",
      CASE
        WHEN agg.due_sum > 0 THEN
          LEAST(100, 100 * (agg.paid_sum + COALESCE(wa.waiver_sum, 0)) / agg.due_sum)
        ELSE 0
      END::text AS "efficiencyPct",
      agg.ledger_count AS "ledgerCount"
    FROM agg
    LEFT JOIN wa ON wa.week_start = agg.week_start
    ORDER BY agg.week_start DESC
  `);

  return Array.from(
    result as unknown as Iterable<{
      weekStartIst: string;
      dueInr: string;
      paidInr: string;
      waivedInr: string;
      efficiencyPct: string;
      ledgerCount: number;
    }>,
  ).map((r) => ({
    weekStartIst: r.weekStartIst,
    dueInr: r.dueInr,
    paidInr: r.paidInr,
    waivedInr: r.waivedInr,
    efficiencyPct: r.efficiencyPct,
    ledgerCount: r.ledgerCount,
  }));
}

export type AdminReportsPageData = {
  platform: AdminPlatformRevenueSummary;
  strategyRevenue: AdminStrategyRevenueRow[];
  userRevenue: AdminUserRevenueRow[];
  topStrategiesPnl: AdminTopStrategyPnlRow[];
  topUsersPnl: AdminTopUserPnlRow[];
  unpaidDues: AdminUnpaidDueRow[];
  waivers: AdminWaiverReportRow[];
  collectionWeeks: AdminCollectionWeekRow[];
};

export async function getAdminReportsPageData(): Promise<AdminReportsPageData | null> {
  if (!db) return null;

  const [
    platform,
    strategyRevenue,
    userRevenue,
    topStrategiesPnl,
    topUsersPnl,
    unpaidDues,
    waivers,
    collectionWeeks,
  ] = await Promise.all([
    getAdminPlatformRevenueSummary(),
    getAdminStrategyRevenueRows(40),
    getAdminUserRevenueRows(50),
    getAdminTopStrategiesByPnl(15),
    getAdminTopUsersByPnl(15),
    getAdminUnpaidDuesReport(100),
    getAdminWaiverReport(150),
    getAdminCollectionEfficiencyByWeek(16),
  ]);

  if (!platform) return null;

  return {
    platform,
    strategyRevenue,
    userRevenue,
    topStrategiesPnl,
    topUsersPnl,
    unpaidDues,
    waivers,
    collectionWeeks,
  };
}
