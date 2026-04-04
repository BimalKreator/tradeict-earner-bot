import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  botOrders,
  payments,
  strategies,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type ReportSeriesPoint = { label: string; valueInr: string };

export type UserStrategyPnlRow = {
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  pnlInr: string;
  fillsCount: number;
};

export type UserFixedFeePaymentRow = {
  id: string;
  createdAt: Date;
  amountInr: string;
  strategyName: string | null;
  subscriptionId: string | null;
  status: string;
  externalPaymentId: string | null;
};

export type UserRevenueSharePaymentRow = {
  id: string;
  createdAt: Date;
  amountInr: string;
  strategyName: string | null;
  weekStartIst: string | null;
  weekEndIst: string | null;
  ledgerStatus: string | null;
  externalPaymentId: string | null;
};

/** Last `days` IST calendar days of realized bot PnL (inclusive). */
export async function getUserDailyPnlSeries(
  userId: string,
  days: number = 90,
): Promise<ReportSeriesPoint[]> {
  if (!db) return [];
  const d = Math.min(Math.max(days, 1), 366);
  const result = await db.execute(sql`
    WITH ist_today AS (SELECT (timezone('Asia/Kolkata', now()))::date AS d),
    series AS (
      SELECT generate_series(
        (SELECT d FROM ist_today) - (${d} - 1) * interval '1 day',
        (SELECT d FROM ist_today),
        interval '1 day'
      )::date AS bucket
    )
    SELECT series.bucket::text AS label,
           COALESCE(SUM(bo.realized_pnl_inr), 0)::text AS "valueInr"
    FROM series
    LEFT JOIN bot_orders bo ON bo.user_id = ${userId}::uuid
      AND bo.trade_source = 'bot'
      AND bo.status IN ('filled', 'partial_fill')
      AND (timezone('Asia/Kolkata', COALESCE(bo.last_synced_at, bo.updated_at)))::date = series.bucket
    GROUP BY series.bucket
    ORDER BY series.bucket
  `);
  return Array.from(
    result as unknown as Iterable<{ label: string; valueInr: string }>,
  ).map((r) => ({ label: r.label, valueInr: r.valueInr }));
}

/** ISO week start (Monday) in IST, last `weeks` weeks of data (sparse weeks omitted). */
export async function getUserWeeklyPnlSeries(
  userId: string,
  weeks: number = 13,
): Promise<ReportSeriesPoint[]> {
  if (!db) return [];
  const w = Math.min(Math.max(weeks, 1), 52);
  const result = await db.execute(sql`
    SELECT (date_trunc(
      'week',
      timezone('Asia/Kolkata', COALESCE(bo.last_synced_at, bo.updated_at))::timestamp
    ))::date::text AS label,
    COALESCE(SUM(bo.realized_pnl_inr), 0)::text AS "valueInr"
    FROM bot_orders bo
    WHERE bo.user_id = ${userId}::uuid
      AND bo.trade_source = 'bot'
      AND bo.status IN ('filled', 'partial_fill')
      AND timezone('Asia/Kolkata', COALESCE(bo.last_synced_at, bo.updated_at))
          >= (timezone('Asia/Kolkata', now()) - (${w} * 7 + 7) * interval '1 day')
    GROUP BY 1
    ORDER BY 1
  `);
  return Array.from(
    result as unknown as Iterable<{ label: string; valueInr: string }>,
  ).map((r) => ({ label: r.label, valueInr: r.valueInr }));
}

/** YYYY-MM buckets in IST, last `months` months. */
export async function getUserMonthlyPnlSeries(
  userId: string,
  months: number = 12,
): Promise<ReportSeriesPoint[]> {
  if (!db) return [];
  const m = Math.min(Math.max(months, 1), 36);
  const result = await db.execute(sql`
    SELECT to_char(
      timezone('Asia/Kolkata', COALESCE(bo.last_synced_at, bo.updated_at)),
      'YYYY-MM'
    ) AS label,
    COALESCE(SUM(bo.realized_pnl_inr), 0)::text AS "valueInr"
    FROM bot_orders bo
    WHERE bo.user_id = ${userId}::uuid
      AND bo.trade_source = 'bot'
      AND bo.status IN ('filled', 'partial_fill')
      AND timezone('Asia/Kolkata', COALESCE(bo.last_synced_at, bo.updated_at))
          >= (date_trunc('month', timezone('Asia/Kolkata', now())) - (${m} - 1) * interval '1 month')
    GROUP BY 1
    ORDER BY 1
  `);
  return Array.from(
    result as unknown as Iterable<{ label: string; valueInr: string }>,
  ).map((r) => ({ label: r.label, valueInr: r.valueInr }));
}

export async function getUserPnlByStrategy(
  userId: string,
  days: number = 365,
): Promise<UserStrategyPnlRow[]> {
  if (!db) return [];
  const d = Math.min(Math.max(days, 1), 730);
  const rows = await db
    .select({
      strategyId: strategies.id,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      pnlInr: sql<string>`coalesce(sum(${botOrders.realizedPnlInr}), 0)::text`,
      fillsCount: sql<number>`count(${botOrders.id})::int`,
    })
    .from(botOrders)
    .innerJoin(strategies, eq(botOrders.strategyId, strategies.id))
    .where(
      and(
        eq(botOrders.userId, userId),
        eq(botOrders.tradeSource, "bot"),
        inArray(botOrders.status, ["filled", "partial_fill"]),
        sql`(timezone('Asia/Kolkata', coalesce(${botOrders.lastSyncedAt}, ${botOrders.updatedAt})))::date >= (timezone('Asia/Kolkata', now()))::date - ${d} * interval '1 day'`,
      ),
    )
    .groupBy(strategies.id, strategies.name, strategies.slug)
    .orderBy(sql`coalesce(sum(${botOrders.realizedPnlInr}), 0) DESC`);

  return rows.map((r) => ({
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    strategySlug: r.strategySlug,
    pnlInr: r.pnlInr,
    fillsCount: r.fillsCount,
  }));
}

/** Subscription / access fee payments (successful), excluding revenue-share ledger settlements. */
export async function getUserFixedFeePayments(
  userId: string,
  limit = 200,
): Promise<UserFixedFeePaymentRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      amountInr: payments.amountInr,
      strategyName: strategies.name,
      subscriptionId: payments.subscriptionId,
      status: payments.status,
      externalPaymentId: payments.externalPaymentId,
    })
    .from(payments)
    .leftJoin(strategies, eq(payments.strategyId, strategies.id))
    .where(
      and(
        eq(payments.userId, userId),
        eq(payments.status, "success"),
        isNull(payments.revenueShareLedgerId),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    amountInr: String(r.amountInr),
    strategyName: r.strategyName,
    subscriptionId: r.subscriptionId,
    status: r.status,
    externalPaymentId: r.externalPaymentId,
  }));
}

export async function getUserRevenueSharePayments(
  userId: string,
  limit = 200,
): Promise<UserRevenueSharePaymentRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      amountInr: payments.amountInr,
      strategyName: strategies.name,
      weekStartIst: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEndIst: weeklyRevenueShareLedgers.weekEndDateIst,
      ledgerStatus: weeklyRevenueShareLedgers.status,
      externalPaymentId: payments.externalPaymentId,
    })
    .from(payments)
    .innerJoin(
      weeklyRevenueShareLedgers,
      eq(payments.revenueShareLedgerId, weeklyRevenueShareLedgers.id),
    )
    .leftJoin(strategies, eq(payments.strategyId, strategies.id))
    .where(and(eq(payments.userId, userId), eq(payments.status, "success")))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    amountInr: String(r.amountInr),
    strategyName: r.strategyName,
    weekStartIst: r.weekStartIst,
    weekEndIst: r.weekEndIst,
    ledgerStatus: r.ledgerStatus,
    externalPaymentId: r.externalPaymentId,
  }));
}

export async function getUserReportsBundle(userId: string) {
  if (!db) return null;
  const [
    dailyPnl,
    weeklyPnl,
    monthlyPnl,
    strategyPnl,
    fixedFees,
    revShare,
  ] = await Promise.all([
    getUserDailyPnlSeries(userId, 90),
    getUserWeeklyPnlSeries(userId, 13),
    getUserMonthlyPnlSeries(userId, 12),
    getUserPnlByStrategy(userId, 365),
    getUserFixedFeePayments(userId),
    getUserRevenueSharePayments(userId),
  ]);

  const sumSeries = (s: ReportSeriesPoint[]) =>
    s.reduce((a, p) => a + (Number(p.valueInr) || 0), 0);

  return {
    dailyPnl,
    weeklyPnl,
    monthlyPnl,
    strategyPnl,
    fixedFees,
    revShare,
    totals: {
      dailyWindowPnlInr: String(sumSeries(dailyPnl)),
      weeklyWindowPnlInr: String(sumSeries(weeklyPnl)),
      monthlyWindowPnlInr: String(sumSeries(monthlyPnl)),
      strategyWindowTotalPnlInr: String(
        strategyPnl.reduce((a, r) => a + (Number(r.pnlInr) || 0), 0),
      ),
    },
  };
}
