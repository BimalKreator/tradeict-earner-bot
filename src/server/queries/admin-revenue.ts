import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";

import { addCalendarDaysYmd } from "@/server/cron/ist-calendar";
import { db } from "@/server/db";
import {
  feeWaivers,
  payments,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type AdminRevenueFilters = {
  /** IST Monday date YYYY-MM-DD; narrows ledger + related payment metrics to that billing week. */
  weekStartIst?: string;
  userEmailQuery?: string;
  billingStatus?: "all" | "blocked" | "clean";
  sort?: "week" | "user" | "outstanding" | "status";
  dir?: "asc" | "desc";
};

export type AdminRevenueSummary = {
  /** Sum of current `amount_due_inr` on ledgers in scope (after waivers have reduced due). */
  totalLedgerDueInr: string;
  /** Sum of `amount_paid_inr` on those ledgers (cash applied to ledgers, not the same as gateway totals). */
  totalLedgerPaidInr: string;
  /** Sum of successful `payments.amount_inr` in scope (all products). */
  totalPaymentsCollectedInr: string;
  /** Sum of max(0, due − paid) for rows in unpaid/partial. */
  totalOutstandingInr: string;
  /** Sum of waiver amounts recorded against revenue ledgers (explicit INR on fee_waivers). */
  totalWaivedInr: string;
  /** Successful Cashfree subscription product payments in scope. */
  subscriptionFeesCollectedInr: string;
  /** Successful revenue-share payments in scope. */
  revenueShareCollectedInr: string;
  ledgerRowCount: number;
  usersBlockedRevenueCount: number;
};

export type AdminRevenueLedgerRow = {
  id: string;
  userId: string;
  userEmail: string;
  userBlockedRevenue: boolean;
  strategyName: string;
  weekStartDateIst: string;
  weekEndDateIst: string;
  amountDueInr: string;
  amountPaidInr: string;
  outstandingInr: string;
  status: string;
  dueAt: string;
  adminNotes: string | null;
};

function assertWeekStartMonday(ymd: string | undefined): ymd is string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 1;
}

function ledgerWeekFilter(weekStart: string | undefined) {
  if (!weekStart || !assertWeekStartMonday(weekStart)) return undefined;
  return eq(weeklyRevenueShareLedgers.weekStartDateIst, weekStart);
}

/**
 * **Net due (UI / ops)** = `amount_due_inr − amount_paid_inr` (clamped ≥ 0).
 * Waivers **reduce `amount_due_inr`** when applied, so they flow through automatically.
 * Historical waiver totals are also summed from `fee_waivers.amount_inr` for reporting.
 */
export async function getAdminRevenueSummary(
  filters: AdminRevenueFilters,
): Promise<AdminRevenueSummary | null> {
  if (!db) return null;

  const week = filters.weekStartIst;
  const weekCond = ledgerWeekFilter(week);

  const [dueAgg] = await db
    .select({
      v: sql<string>`coalesce(sum(cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)), 0)::text`,
      c: sql<number>`count(*)::int`,
    })
    .from(weeklyRevenueShareLedgers)
    .where(weekCond ? and(weekCond) : undefined);

  const [paidAgg] = await db
    .select({
      v: sql<string>`coalesce(sum(cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)), 0)::text`,
    })
    .from(weeklyRevenueShareLedgers)
    .where(weekCond ? and(weekCond) : undefined);

  const outstandingWhere = weekCond
    ? and(
        weekCond,
        inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
      )
    : inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]);

  const [outAgg] = await db
    .select({
      v: sql<string>`coalesce(
        sum(
          greatest(
            0,
            cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
            - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)
          )
        ),
        0
      )::text`,
    })
    .from(weeklyRevenueShareLedgers)
    .where(outstandingWhere);

  const waiverConds = [isNotNull(feeWaivers.revenueLedgerId)];
  if (week && assertWeekStartMonday(week)) {
    waiverConds.push(
      inArray(
        feeWaivers.revenueLedgerId,
        db
          .select({ id: weeklyRevenueShareLedgers.id })
          .from(weeklyRevenueShareLedgers)
          .where(eq(weeklyRevenueShareLedgers.weekStartDateIst, week)),
      ),
    );
  }

  const [waivedAgg] = await db
    .select({
      v: sql<string>`coalesce(sum(cast(${feeWaivers.amountInr} as numeric)), 0)::text`,
    })
    .from(feeWaivers)
    .where(and(...waiverConds));

  let allSuccessCond = eq(payments.status, "success");
  let subscriptionCond = and(
    eq(payments.status, "success"),
    isNull(payments.revenueShareLedgerId),
  );
  let revPayCond = and(
    eq(payments.status, "success"),
    isNotNull(payments.revenueShareLedgerId),
  );

  if (week && assertWeekStartMonday(week)) {
    const weekEnd = addCalendarDaysYmd(week, 6);
    const weekPay = sql`(timezone('Asia/Kolkata', ${payments.createdAt}))::date >= ${week}::date
      and (timezone('Asia/Kolkata', ${payments.createdAt}))::date <= ${weekEnd}::date`;
    allSuccessCond = and(allSuccessCond, weekPay)!;
    subscriptionCond = and(subscriptionCond, weekPay)!;
    revPayCond = and(revPayCond, weekPay)!;
  }

  const [allSuccessPay] = await db
    .select({
      v: sql<string>`coalesce(sum(cast(${payments.amountInr} as numeric)), 0)::text`,
    })
    .from(payments)
    .where(allSuccessCond);

  const [subPay] = await db
    .select({
      v: sql<string>`coalesce(sum(cast(${payments.amountInr} as numeric)), 0)::text`,
    })
    .from(payments)
    .where(subscriptionCond);

  const [revPay] = await db
    .select({
      v: sql<string>`coalesce(sum(cast(${payments.amountInr} as numeric)), 0)::text`,
    })
    .from(payments)
    .where(revPayCond);

  const [blockedUsers] = await db
    .select({
      c: sql<number>`count(distinct ${userStrategySubscriptions.userId})::int`,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategySubscriptions.id, userStrategyRuns.subscriptionId),
    )
    .where(eq(userStrategyRuns.status, "blocked_revenue_due"));

  return {
    totalLedgerDueInr: dueAgg?.v ?? "0",
    totalLedgerPaidInr: paidAgg?.v ?? "0",
    totalPaymentsCollectedInr: allSuccessPay?.v ?? "0",
    totalOutstandingInr: outAgg?.v ?? "0",
    totalWaivedInr: waivedAgg?.v ?? "0",
    subscriptionFeesCollectedInr: subPay?.v ?? "0",
    revenueShareCollectedInr: revPay?.v ?? "0",
    ledgerRowCount: Number(dueAgg?.c ?? 0),
    usersBlockedRevenueCount: Number(blockedUsers?.c ?? 0),
  };
}

export async function getAdminRevenueLedgerRows(
  filters: AdminRevenueFilters,
  limit = 400,
): Promise<AdminRevenueLedgerRow[]> {
  if (!db) return [];

  const weekCond = ledgerWeekFilter(filters.weekStartIst);
  const emailQ = filters.userEmailQuery?.trim();

  const userBlockedRunSubq = db
    .select({ x: sql`1` })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategySubscriptions.id, userStrategyRuns.subscriptionId),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, users.id),
        eq(userStrategyRuns.status, "blocked_revenue_due"),
      ),
    );

  const conds = [];
  if (weekCond) conds.push(weekCond);
  if (emailQ) {
    conds.push(ilike(users.email, `%${emailQ}%`));
  }
  if (filters.billingStatus === "blocked") {
    conds.push(exists(userBlockedRunSubq));
  } else if (filters.billingStatus === "clean") {
    conds.push(notExists(userBlockedRunSubq));
  }

  const sort = filters.sort ?? "week";
  const dir = filters.dir === "asc" ? "asc" : "desc";

  const orderExprs =
    sort === "user"
      ? dir === "asc"
        ? [users.email, weeklyRevenueShareLedgers.weekStartDateIst]
        : [desc(users.email), desc(weeklyRevenueShareLedgers.weekStartDateIst)]
      : sort === "status"
        ? dir === "asc"
          ? [
              weeklyRevenueShareLedgers.status,
              weeklyRevenueShareLedgers.weekStartDateIst,
            ]
          : [
              desc(weeklyRevenueShareLedgers.status),
              desc(weeklyRevenueShareLedgers.weekStartDateIst),
            ]
        : sort === "outstanding"
          ? dir === "asc"
            ? [
                sql`(
              cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
              - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)
            )`,
                weeklyRevenueShareLedgers.weekStartDateIst,
              ]
            : [
                desc(
                  sql`(
              cast(${weeklyRevenueShareLedgers.amountDueInr} as numeric)
              - cast(${weeklyRevenueShareLedgers.amountPaidInr} as numeric)
            )`,
                ),
                desc(weeklyRevenueShareLedgers.weekStartDateIst),
              ]
          : dir === "asc"
            ? [
                weeklyRevenueShareLedgers.weekStartDateIst,
                users.email,
              ]
            : [
                desc(weeklyRevenueShareLedgers.weekStartDateIst),
                desc(users.email),
              ];

  const rows = await db
    .select({
      id: weeklyRevenueShareLedgers.id,
      userId: weeklyRevenueShareLedgers.userId,
      userEmail: users.email,
      strategyName: strategies.name,
      weekStartDateIst: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEndDateIst: weeklyRevenueShareLedgers.weekEndDateIst,
      amountDueInr: weeklyRevenueShareLedgers.amountDueInr,
      amountPaidInr: weeklyRevenueShareLedgers.amountPaidInr,
      status: weeklyRevenueShareLedgers.status,
      dueAt: weeklyRevenueShareLedgers.dueAt,
      adminNotes: weeklyRevenueShareLedgers.adminNotes,
      blocked: sql<boolean>`exists (
        select 1 from ${userStrategyRuns} usr
        inner join ${userStrategySubscriptions} uss on uss.id = usr.subscription_id
        where uss.user_id = ${users.id}
        and usr.status = 'blocked_revenue_due'
      )`,
    })
    .from(weeklyRevenueShareLedgers)
    .innerJoin(users, eq(users.id, weeklyRevenueShareLedgers.userId))
    .innerJoin(
      strategies,
      eq(strategies.id, weeklyRevenueShareLedgers.strategyId),
    )
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...orderExprs)
    .limit(Math.min(Math.max(limit, 1), 500));

  return rows.map((r) => {
    const due = Number(r.amountDueInr);
    const paid = Number(r.amountPaidInr);
    const out =
      Number.isFinite(due) && Number.isFinite(paid)
        ? Math.max(0, due - paid)
        : 0;
    return {
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      userBlockedRevenue: Boolean(r.blocked),
      strategyName: r.strategyName ?? "—",
      weekStartDateIst: String(r.weekStartDateIst),
      weekEndDateIst: String(r.weekEndDateIst),
      amountDueInr: String(r.amountDueInr),
      amountPaidInr: String(r.amountPaidInr),
      outstandingInr: out.toFixed(2),
      status: r.status,
      dueAt: r.dueAt.toISOString(),
      adminNotes: r.adminNotes ?? null,
    };
  });
}

export type AdminUserBillingSubscriptionRow = {
  subscriptionId: string;
  strategyName: string;
  status: string;
  accessValidUntil: string;
  runStatus: string;
};

export type AdminUserBillingLedgerRow = {
  id: string;
  strategyName: string;
  weekStart: string;
  weekEnd: string;
  amountDueInr: string;
  amountPaidInr: string;
  outstandingInr: string;
  status: string;
  dueAt: string;
  adminNotes: string | null;
};

export type AdminUserBillingPaymentRow = {
  id: string;
  amountInr: string;
  status: string;
  kind: "subscription" | "revenue_share" | "other";
  createdAt: string;
  strategyName: string | null;
  adminNotes: string | null;
};

export async function getAdminUserBillingDetail(userId: string): Promise<{
  email: string;
  name: string | null;
  blockedRevenue: boolean;
  subscriptions: AdminUserBillingSubscriptionRow[];
  ledgers: AdminUserBillingLedgerRow[];
  payments: AdminUserBillingPaymentRow[];
} | null> {
  if (!db) return null;

  const [u] = await db
    .select({
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!u) return null;

  const [blk] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategySubscriptions.id, userStrategyRuns.subscriptionId),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        eq(userStrategyRuns.status, "blocked_revenue_due"),
      ),
    );

  const subs = await db
    .select({
      subscriptionId: userStrategySubscriptions.id,
      strategyName: strategies.name,
      subStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      runStatus: userStrategyRuns.status,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      strategies,
      eq(strategies.id, userStrategySubscriptions.strategyId),
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
    .orderBy(desc(userStrategySubscriptions.createdAt));

  const ledgers = await db
    .select({
      id: weeklyRevenueShareLedgers.id,
      strategyName: strategies.name,
      weekStart: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEnd: weeklyRevenueShareLedgers.weekEndDateIst,
      amountDueInr: weeklyRevenueShareLedgers.amountDueInr,
      amountPaidInr: weeklyRevenueShareLedgers.amountPaidInr,
      status: weeklyRevenueShareLedgers.status,
      dueAt: weeklyRevenueShareLedgers.dueAt,
      adminNotes: weeklyRevenueShareLedgers.adminNotes,
    })
    .from(weeklyRevenueShareLedgers)
    .innerJoin(
      strategies,
      eq(strategies.id, weeklyRevenueShareLedgers.strategyId),
    )
    .where(eq(weeklyRevenueShareLedgers.userId, userId))
    .orderBy(desc(weeklyRevenueShareLedgers.weekStartDateIst))
    .limit(100);

  const payRows = await db
    .select({
      id: payments.id,
      amountInr: payments.amountInr,
      status: payments.status,
      createdAt: payments.createdAt,
      strategyName: strategies.name,
      revenueShareLedgerId: payments.revenueShareLedgerId,
      strategyId: payments.strategyId,
      adminNotes: payments.adminNotes,
    })
    .from(payments)
    .leftJoin(strategies, eq(payments.strategyId, strategies.id))
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(80);

  return {
    email: u.email,
    name: u.name,
    blockedRevenue: Number(blk?.c ?? 0) > 0,
    subscriptions: subs.map((s) => ({
      subscriptionId: s.subscriptionId,
      strategyName: s.strategyName ?? "—",
      status: s.subStatus,
      accessValidUntil: s.accessValidUntil.toISOString(),
      runStatus: s.runStatus,
    })),
    ledgers: ledgers.map((r) => {
      const due = Number(r.amountDueInr);
      const paid = Number(r.amountPaidInr);
      const out =
        Number.isFinite(due) && Number.isFinite(paid)
          ? Math.max(0, due - paid)
          : 0;
      return {
        id: r.id,
        strategyName: r.strategyName ?? "—",
        weekStart: String(r.weekStart),
        weekEnd: String(r.weekEnd),
        amountDueInr: String(r.amountDueInr),
        amountPaidInr: String(r.amountPaidInr),
        outstandingInr: out.toFixed(2),
        status: r.status,
        dueAt: r.dueAt.toISOString(),
        adminNotes: r.adminNotes ?? null,
      };
    }),
    payments: payRows.map((p) => ({
      id: p.id,
      amountInr: String(p.amountInr),
      status: p.status,
      kind: p.revenueShareLedgerId
        ? ("revenue_share" as const)
        : p.strategyId
          ? ("subscription" as const)
          : ("other" as const),
      createdAt: p.createdAt.toISOString(),
      strategyName: p.strategyName,
      adminNotes: p.adminNotes ?? null,
    })),
  };
}
