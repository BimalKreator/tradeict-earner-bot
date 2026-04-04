import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/server/db";
import {
  exchangeConnections,
  strategies,
  users,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";
import { subscriptionHasBlockingOverdueLedger } from "@/server/revenue/revenue-due-gate";

export type AdminUserStrategyRunBucket =
  | "all"
  | "active"
  | "paused"
  | "expired"
  | "blocked";

export type AdminUserStrategyListFilters = {
  q?: string;
  strategyId?: string;
  runBucket?: AdminUserStrategyRunBucket;
  /** Inclusive YYYY-MM-DD on subscription.access_valid_until (UTC calendar date of instant). */
  expFrom?: string;
  expTo?: string;
};

export type AdminUserStrategyListRow = {
  subscriptionId: string;
  runId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  subscriptionStatus: string;
  accessValidUntil: Date;
  runStatus: string;
  capitalToUseInr: string | null;
  leverage: string | null;
};

function parseYmd(s: string | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function bucketCondition(
  bucket: AdminUserStrategyRunBucket | undefined,
  now: Date,
) {
  const b = bucket ?? "all";
  if (b === "all") return undefined;
  if (b === "active") {
    return eq(userStrategyRuns.status, "active");
  }
  if (b === "blocked") {
    return inArray(userStrategyRuns.status, [
      "blocked_revenue_due",
      "paused_revenue_due",
    ]);
  }
  if (b === "expired") {
    return or(
      eq(userStrategyRuns.status, "expired"),
      lte(userStrategySubscriptions.accessValidUntil, now),
    );
  }
  if (b === "paused") {
    return and(
      gt(userStrategySubscriptions.accessValidUntil, now),
      inArray(userStrategyRuns.status, [
        "paused_admin",
        "paused_by_user",
        "paused_exchange_off",
        "paused_insufficient_funds",
        "inactive",
        "ready_to_activate",
        "paused",
      ]),
    );
  }
  return undefined;
}

export async function listAdminUserStrategySubscriptions(
  filters: AdminUserStrategyListFilters,
  limit = 300,
): Promise<AdminUserStrategyListRow[]> {
  if (!db) return [];

  const now = new Date();
  const q = filters.q?.trim();
  const expFrom = parseYmd(filters.expFrom);
  const expTo = parseYmd(filters.expTo);

  const conds = [isNull(userStrategySubscriptions.deletedAt)];

  if (q) {
    conds.push(
      or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))!,
    );
  }

  if (filters.strategyId) {
    conds.push(eq(userStrategySubscriptions.strategyId, filters.strategyId));
  }

  const bc = bucketCondition(filters.runBucket, now);
  if (bc) conds.push(bc);

  if (expFrom) {
    conds.push(
      sql`(${userStrategySubscriptions.accessValidUntil})::date >= ${expFrom}::date`,
    );
  }
  if (expTo) {
    conds.push(
      sql`(${userStrategySubscriptions.accessValidUntil})::date <= ${expTo}::date`,
    );
  }

  const rows = await db
    .select({
      subscriptionId: userStrategySubscriptions.id,
      runId: userStrategyRuns.id,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      strategyId: strategies.id,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      subscriptionStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
    })
    .from(userStrategySubscriptions)
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(and(...conds))
    .orderBy(desc(userStrategySubscriptions.accessValidUntil))
    .limit(Math.min(Math.max(limit, 1), 500));

  return rows.map((r) => ({
    subscriptionId: r.subscriptionId,
    runId: r.runId,
    userId: r.userId,
    userEmail: r.userEmail,
    userName: r.userName,
    strategyId: r.strategyId,
    strategyName: r.strategyName ?? "—",
    strategySlug: r.strategySlug,
    subscriptionStatus: r.subscriptionStatus,
    accessValidUntil: r.accessValidUntil,
    runStatus: r.runStatus,
    capitalToUseInr: r.capitalToUseInr != null ? String(r.capitalToUseInr) : null,
    leverage: r.leverage != null ? String(r.leverage) : null,
  }));
}

export type AdminUserStrategyDetail = {
  subscriptionId: string;
  runId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  userApprovalStatus: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  strategyCatalogStatus: string;
  subscriptionStatus: string;
  accessValidUntil: Date;
  purchasedAt: Date;
  runStatus: string;
  capitalToUseInr: string | null;
  leverage: string | null;
  activatedAt: Date | null;
  pausedAt: Date | null;
  lastStateReason: string | null;
  revenueBlocking: boolean;
  exchange: {
    status: string | null;
    lastTestStatus: string | null;
    lastTestAt: Date | null;
    hasKeys: boolean;
  } | null;
};

export async function getAdminUserStrategyDetail(
  subscriptionId: string,
): Promise<AdminUserStrategyDetail | null> {
  if (!db) return null;

  const [row] = await db
    .select({
      subscriptionId: userStrategySubscriptions.id,
      runId: userStrategyRuns.id,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      userApprovalStatus: users.approvalStatus,
      strategyId: strategies.id,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      strategyCatalogStatus: strategies.status,
      subscriptionStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      purchasedAt: userStrategySubscriptions.purchasedAt,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
      activatedAt: userStrategyRuns.activatedAt,
      pausedAt: userStrategyRuns.pausedAt,
      lastStateReason: userStrategyRuns.lastStateReason,
    })
    .from(userStrategySubscriptions)
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
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
        eq(userStrategySubscriptions.id, subscriptionId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const revenueBlocking = await subscriptionHasBlockingOverdueLedger(
    subscriptionId,
  );

  const [ec] = await db
    .select({
      status: exchangeConnections.status,
      lastTestStatus: exchangeConnections.lastTestStatus,
      lastTestAt: exchangeConnections.lastTestAt,
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, row.userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .orderBy(desc(exchangeConnections.updatedAt))
    .limit(1);

  const hasKeys = Boolean(
    ec?.apiKeyCiphertext?.trim() && ec?.apiSecretCiphertext?.trim(),
  );

  return {
    subscriptionId: row.subscriptionId,
    runId: row.runId,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    userApprovalStatus: row.userApprovalStatus,
    strategyId: row.strategyId,
    strategyName: row.strategyName ?? "—",
    strategySlug: row.strategySlug,
    strategyCatalogStatus: row.strategyCatalogStatus,
    subscriptionStatus: row.subscriptionStatus,
    accessValidUntil: row.accessValidUntil,
    purchasedAt: row.purchasedAt,
    runStatus: row.runStatus,
    capitalToUseInr:
      row.capitalToUseInr != null ? String(row.capitalToUseInr) : null,
    leverage: row.leverage != null ? String(row.leverage) : null,
    activatedAt: row.activatedAt,
    pausedAt: row.pausedAt,
    lastStateReason: row.lastStateReason,
    revenueBlocking,
    exchange: ec
      ? {
          status: ec.status,
          lastTestStatus: ec.lastTestStatus,
          lastTestAt: ec.lastTestAt,
          hasKeys,
        }
      : null,
  };
}
