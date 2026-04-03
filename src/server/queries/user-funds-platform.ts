import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "@/server/db";
import {
  botOrders,
  feeWaivers,
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
  kind: "subscription" | "revenue_share" | "other";
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
    conds.push(isNull(payments.revenueShareLedgerId));
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
      revenueShareLedgerId: payments.revenueShareLedgerId,
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
    kind: r.revenueShareLedgerId
      ? ("revenue_share" as const)
      : r.strategyId
        ? ("subscription" as const)
        : ("other" as const),
  }));
}

export type RevenueLedgerRow = {
  id: string;
  weekStart: string;
  weekEnd: string;
  amountDueInr: string;
  amountPaidInr: string;
  outstandingInr: string;
  status: string;
  dueAt: string;
  strategyName: string;
  revenueSharePercentApplied: string;
  weeklyNetProfitInr: string | null;
  waiverSummary: string;
  /** Latest Cashfree payment row for this ledger (created / pending / failed / success / …). */
  latestPaymentStatus: string | null;
};

function buildWaiverSummary(
  ledgerId: string,
  waiverRows: {
    revenueLedgerId: string | null;
    amountInr: string | null;
    reason: string;
  }[],
): string {
  const mine = waiverRows.filter((w) => w.revenueLedgerId === ledgerId);
  if (mine.length === 0) return "—";
  return mine
    .map((w) => {
      const amt = w.amountInr != null && String(w.amountInr).trim() !== ""
        ? `₹${w.amountInr}`
        : "Full waiver";
      return `${amt}: ${w.reason}`;
    })
    .join(" · ");
}

export async function getUserRecentRevenueLedgers(
  userId: string,
  limit = 8,
): Promise<RevenueLedgerRow[]> {
  if (!db) return [];
  const lim = Math.min(limit, 24);

  const rows = await db
    .select({
      id: weeklyRevenueShareLedgers.id,
      weekStart: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEnd: weeklyRevenueShareLedgers.weekEndDateIst,
      amountDueInr: weeklyRevenueShareLedgers.amountDueInr,
      amountPaidInr: weeklyRevenueShareLedgers.amountPaidInr,
      status: weeklyRevenueShareLedgers.status,
      dueAt: weeklyRevenueShareLedgers.dueAt,
      strategyName: strategies.name,
      revenueSharePercentApplied:
        weeklyRevenueShareLedgers.revenueSharePercentApplied,
      ledgerMetadata: weeklyRevenueShareLedgers.metadata,
    })
    .from(weeklyRevenueShareLedgers)
    .innerJoin(
      strategies,
      eq(weeklyRevenueShareLedgers.strategyId, strategies.id),
    )
    .where(eq(weeklyRevenueShareLedgers.userId, userId))
    .orderBy(desc(weeklyRevenueShareLedgers.dueAt))
    .limit(lim);

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const waiverRows =
    ids.length > 0
      ? await db
          .select({
            revenueLedgerId: feeWaivers.revenueLedgerId,
            amountInr: feeWaivers.amountInr,
            reason: feeWaivers.reason,
          })
          .from(feeWaivers)
          .where(inArray(feeWaivers.revenueLedgerId, ids))
      : [];

  const latestPayRows =
    ids.length > 0
      ? await db
          .select({
            ledgerId: payments.revenueShareLedgerId,
            status: payments.status,
            updatedAt: payments.updatedAt,
          })
          .from(payments)
          .where(
            and(
              inArray(payments.revenueShareLedgerId, ids),
              isNotNull(payments.revenueShareLedgerId),
            ),
          )
          .orderBy(desc(payments.updatedAt))
      : [];

  const latestPayByLedger = new Map<string, string>();
  for (const p of latestPayRows) {
    if (p.ledgerId && !latestPayByLedger.has(p.ledgerId)) {
      latestPayByLedger.set(p.ledgerId, p.status);
    }
  }

  return rows.map((r) => {
    const dueN = Number(r.amountDueInr);
    const paidN = Number(r.amountPaidInr);
    const out = Number.isFinite(dueN) && Number.isFinite(paidN)
      ? Math.max(0, dueN - paidN)
      : 0;
    const meta = r.ledgerMetadata as Record<string, unknown> | null;
    const wnp = meta?.weekly_net_profit_inr;
    const weeklyNet =
      typeof wnp === "string" || typeof wnp === "number"
        ? String(wnp)
        : null;

    return {
      id: r.id,
      weekStart: String(r.weekStart),
      weekEnd: String(r.weekEnd),
      amountDueInr: String(r.amountDueInr),
      amountPaidInr: String(r.amountPaidInr),
      outstandingInr: out.toFixed(2),
      status: r.status,
      dueAt: r.dueAt.toISOString(),
      strategyName: r.strategyName ?? "—",
      revenueSharePercentApplied: String(r.revenueSharePercentApplied),
      weeklyNetProfitInr: weeklyNet,
      waiverSummary: buildWaiverSummary(r.id, waiverRows),
      latestPaymentStatus: latestPayByLedger.get(r.id) ?? null,
    };
  });
}
