import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
  sum,
} from "drizzle-orm";

import { db } from "@/server/db";
import {
  auditLogs,
  botExecutionLogs,
  botOrders,
  payments,
  profileChangeRequests,
  strategies,
  users,
  userStrategyRuns,
  userStrategySubscriptions,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type AdminDashboardMetrics = {
  totalUsers: number;
  pendingApprovals: number;
  approvedUsers: number;
  totalStrategies: number;
  activeSubscriptions: number;
  /** All unpaid / partial revenue-share ledger balances (platform-wide). */
  revenueSharePendingInr: string;
  /** Sum of `payments.amount_inr` where status = success. */
  totalCollectedRevenueInr: string;
  /** Count of `user_strategy_runs` with status `active`. */
  activeBotRuns: number;
  /** Runs in `blocked_revenue_due` (weekly revenue overdue — entries paused). */
  blockedRevenueDueRuns: number;
  /** Sum of `capital_to_use_inr` for active runs (nulls treated as 0 in SQL). */
  globalCapitalAllocatedInr: string;
};

const zeroMetrics: AdminDashboardMetrics = {
  totalUsers: 0,
  pendingApprovals: 0,
  approvedUsers: 0,
  totalStrategies: 0,
  activeSubscriptions: 0,
  revenueSharePendingInr: "0",
  totalCollectedRevenueInr: "0",
  activeBotRuns: 0,
  blockedRevenueDueRuns: 0,
  globalCapitalAllocatedInr: "0",
};

function formatDecimal(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0";
  return v;
}

export type AdminAttentionRunRow = {
  runId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  strategyName: string;
  status: string;
  lastStateReason: string | null;
  updatedAt: Date;
};

export type AdminAttentionUserRow = {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;
};

export type AdminAttentionProfileRow = {
  requestId: string;
  userId: string;
  email: string;
  createdAt: Date;
};

export type AdminActivityItem = {
  id: string;
  kind: "audit" | "payment" | "bot_error";
  at: string;
  title: string;
  detail: string;
};

export type AdminRegistrationDay = {
  date: string;
  count: number;
};

export type AdminDashboardPageData = {
  metrics: AdminDashboardMetrics;
  attentionRuns: AdminAttentionRunRow[];
  attentionPendingUsers: AdminAttentionUserRow[];
  attentionProfileRequests: AdminAttentionProfileRow[];
  activity: AdminActivityItem[];
  registrationsLast7Days: AdminRegistrationDay[];
};

const RUN_ATTENTION_STATUSES = [
  "paused_exchange_off",
  "paused_admin",
  "blocked_revenue_due",
] as const;

/**
 * Core KPI aggregations: each metric uses one indexed scan / aggregate — no N+1.
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
    activeRunsRow,
    blockedRevRow,
    capitalRow,
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
        )::text`.as("due"),
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
    db
      .select({ c: count() })
      .from(userStrategyRuns)
      .where(eq(userStrategyRuns.status, "active")),
    db
      .select({ c: count() })
      .from(userStrategyRuns)
      .where(eq(userStrategyRuns.status, "blocked_revenue_due")),
    db
      .select({
        v: sql<string>`coalesce(
          sum(cast(${userStrategyRuns.capitalToUseInr} as numeric)),
          0
        )::text`.as("cap"),
      })
      .from(userStrategyRuns)
      .where(eq(userStrategyRuns.status, "active")),
  ]);

  return {
    totalUsers: Number(totalUsersRow[0]?.c ?? 0),
    pendingApprovals: Number(pendingRow[0]?.c ?? 0),
    approvedUsers: Number(approvedRow[0]?.c ?? 0),
    totalStrategies: Number(strategiesRow[0]?.c ?? 0),
    activeSubscriptions: Number(subsRow[0]?.c ?? 0),
    revenueSharePendingInr: formatDecimal(dueRow[0]?.v),
    totalCollectedRevenueInr: formatDecimal(revenueRow[0]?.v),
    activeBotRuns: Number(activeRunsRow[0]?.c ?? 0),
    blockedRevenueDueRuns: Number(blockedRevRow[0]?.c ?? 0),
    globalCapitalAllocatedInr: formatDecimal(capitalRow[0]?.v),
  };
}

async function fetchAttentionRuns(): Promise<AdminAttentionRunRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      runId: userStrategyRuns.id,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      strategyName: strategies.name,
      status: userStrategyRuns.status,
      lastStateReason: userStrategyRuns.lastStateReason,
      updatedAt: userStrategyRuns.updatedAt,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
    .where(
      and(
        inArray(userStrategyRuns.status, [...RUN_ATTENTION_STATUSES]),
        isNull(users.deletedAt),
        isNull(strategies.deletedAt),
      ),
    )
    .orderBy(desc(userStrategyRuns.updatedAt))
    .limit(25);

  return rows.map((r) => ({
    runId: r.runId,
    userId: r.userId,
    userEmail: r.userEmail,
    userName: r.userName,
    strategyName: r.strategyName,
    status: r.status,
    lastStateReason: r.lastStateReason,
    updatedAt: r.updatedAt,
  }));
}

async function fetchAttentionPendingUsers(): Promise<AdminAttentionUserRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.approvalStatus, "pending_approval"),
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(12);

  return rows;
}

async function fetchAttentionProfileRequests(): Promise<
  AdminAttentionProfileRow[]
> {
  if (!db) return [];
  const rows = await db
    .select({
      requestId: profileChangeRequests.id,
      userId: profileChangeRequests.userId,
      email: users.email,
      createdAt: profileChangeRequests.createdAt,
    })
    .from(profileChangeRequests)
    .innerJoin(users, eq(profileChangeRequests.userId, users.id))
    .where(
      and(
        eq(profileChangeRequests.status, "pending"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(desc(profileChangeRequests.createdAt))
    .limit(12);

  return rows;
}

async function fetchRegistrationsSeries(): Promise<AdminRegistrationDay[]> {
  if (!db) return [];
  const result = await db.execute(sql`
    WITH ist_today AS (SELECT (timezone('Asia/Kolkata', now()))::date AS d),
    series AS (
      SELECT generate_series(
        (SELECT d FROM ist_today) - interval '6 days',
        (SELECT d FROM ist_today),
        interval '1 day'
      )::date AS bucket
    )
    SELECT series.bucket::text AS day_ist,
           count(u.id)::int AS c
    FROM series
    LEFT JOIN users u ON (timezone('Asia/Kolkata', u.created_at))::date = series.bucket
      AND u.deleted_at IS NULL
    GROUP BY series.bucket
    ORDER BY series.bucket
  `);
  return Array.from(
    result as unknown as Iterable<{ day_ist: string; c: number }>,
  ).map((r) => ({ date: r.day_ist, count: r.c }));
}

async function buildActivityFeed(): Promise<AdminActivityItem[]> {
  if (!db) return [];

  const [audits, pays, botErrs] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        actorType: auditLogs.actorType,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(12),
    db
      .select({
        id: payments.id,
        createdAt: payments.createdAt,
        amountInr: payments.amountInr,
        email: users.email,
      })
      .from(payments)
      .innerJoin(users, eq(payments.userId, users.id))
      .where(eq(payments.status, "success"))
      .orderBy(desc(payments.createdAt))
      .limit(6),
    db
      .select({
        id: botExecutionLogs.id,
        createdAt: botExecutionLogs.createdAt,
        message: botExecutionLogs.message,
        email: users.email,
      })
      .from(botExecutionLogs)
      .innerJoin(botOrders, eq(botExecutionLogs.botOrderId, botOrders.id))
      .innerJoin(users, eq(botOrders.userId, users.id))
      .where(eq(botExecutionLogs.level, "error"))
      .orderBy(desc(botExecutionLogs.createdAt))
      .limit(6),
  ]);

  const items: AdminActivityItem[] = [];

  for (const a of audits) {
    items.push({
      id: `audit-${a.id}`,
      kind: "audit",
      at: a.createdAt.toISOString(),
      title: a.action.replace(/_/g, " "),
      detail: `${a.actorType} · ${a.entityType}`,
    });
  }
  for (const p of pays) {
    items.push({
      id: `pay-${p.id}`,
      kind: "payment",
      at: p.createdAt.toISOString(),
      title: "Payment success",
      detail: `${p.email} · ₹${String(p.amountInr)}`,
    });
  }
  for (const b of botErrs) {
    items.push({
      id: `bot-${b.id}`,
      kind: "bot_error",
      at: b.createdAt.toISOString(),
      title: "Bot execution error",
      detail: `${b.email} · ${b.message.slice(0, 120)}${b.message.length > 120 ? "…" : ""}`,
    });
  }

  items.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return items.slice(0, 10);
}

/**
 * Full admin dashboard payload: metrics + attention slices + merged activity + IST registration chart.
 * All slices run in parallel after metrics (or single Promise.all for everything).
 */
export async function getAdminDashboardPageData(): Promise<AdminDashboardPageData | null> {
  if (!db) return null;

  const [
    metrics,
    attentionRuns,
    attentionPendingUsers,
    attentionProfileRequests,
    activity,
    registrationsLast7Days,
  ] = await Promise.all([
    getAdminDashboardMetrics(),
    fetchAttentionRuns(),
    fetchAttentionPendingUsers(),
    fetchAttentionProfileRequests(),
    buildActivityFeed(),
    fetchRegistrationsSeries(),
  ]);

  return {
    metrics,
    attentionRuns,
    attentionPendingUsers,
    attentionProfileRequests,
    activity,
    registrationsLast7Days,
  };
}
