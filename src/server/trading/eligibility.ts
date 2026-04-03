import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  exchangeConnections,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
} from "@/server/db/schema";

export type EligibleStrategyRunRow = {
  userId: string;
  subscriptionId: string;
  runId: string;
  strategyId: string;
  exchangeConnectionId: string;
  capitalToUseInr: string;
  leverage: string;
};

const hasKeysExpr = sql`(
  length(trim(coalesce(${exchangeConnections.apiKeyCiphertext}, ''))) > 0
  and length(trim(coalesce(${exchangeConnections.apiSecretCiphertext}, ''))) > 0
)`;

/**
 * Runs that may execute trades for a strategy: approved user, active subscription,
 * run `active`, strategy `active`, latest Delta connection on + tested + keys,
 * capital/leverage set.
 */
export async function findEligibleRunsForStrategyExecution(
  strategyId: string,
  options?: { targetUserIds?: string[] },
): Promise<EligibleStrategyRunRow[]> {
  if (!db) return [];

  const now = new Date();

  const latestDeltaEc = db
    .selectDistinctOn([exchangeConnections.userId], {
      connectionId: exchangeConnections.id,
      userId: exchangeConnections.userId,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
        eq(exchangeConnections.status, "active"),
        eq(exchangeConnections.lastTestStatus, "success"),
        hasKeysExpr,
      ),
    )
    .orderBy(
      exchangeConnections.userId,
      desc(exchangeConnections.updatedAt),
    )
    .as("latest_delta_ec");

  const filters = [
    eq(strategies.id, strategyId),
    eq(userStrategyRuns.status, "active"),
    eq(userStrategySubscriptions.status, "active"),
    gt(userStrategySubscriptions.accessValidUntil, now),
    isNull(userStrategySubscriptions.deletedAt),
    eq(users.approvalStatus, "approved"),
    isNull(users.deletedAt),
    eq(strategies.status, "active"),
    isNull(strategies.deletedAt),
    sql`${userStrategyRuns.capitalToUseInr} is not null`,
    sql`${userStrategyRuns.leverage} is not null`,
  ];

  if (options?.targetUserIds?.length) {
    filters.push(inArray(users.id, options.targetUserIds));
  }

  const rows = await db
    .select({
      userId: users.id,
      subscriptionId: userStrategySubscriptions.id,
      runId: userStrategyRuns.id,
      strategyId: strategies.id,
      exchangeConnectionId: exchangeConnections.id,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(
      latestDeltaEc,
      eq(latestDeltaEc.userId, users.id),
    )
    .innerJoin(
      exchangeConnections,
      eq(exchangeConnections.id, latestDeltaEc.connectionId),
    )
    .where(and(...filters));

  return rows.map((r) => ({
    userId: r.userId,
    subscriptionId: r.subscriptionId,
    runId: r.runId,
    strategyId: r.strategyId,
    exchangeConnectionId: r.exchangeConnectionId,
    capitalToUseInr: String(r.capitalToUseInr),
    leverage: String(r.leverage),
  }));
}

export type ExecutionEligibilityFailure =
  | "run_not_found"
  | "user_not_approved"
  | "subscription_inactive"
  | "strategy_inactive"
  | "run_not_active"
  | "revenue_or_pause_block"
  | "exchange_not_ready"
  | "settings_incomplete";

/**
 * Re-check a single run immediately before placing an order (worker safety).
 */
export async function assertRunStillEligibleForExecution(
  runId: string,
): Promise<{ ok: true; row: EligibleStrategyRunRow } | { ok: false; reason: ExecutionEligibilityFailure }> {
  if (!db) return { ok: false, reason: "run_not_found" };

  const now = new Date();

  const [r] = await db
    .select({
      userId: users.id,
      subscriptionId: userStrategySubscriptions.id,
      runId: userStrategyRuns.id,
      strategyId: strategies.id,
      runStatus: userStrategyRuns.status,
      subStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      approval: users.approvalStatus,
      stratStatus: strategies.status,
      stratDeleted: strategies.deletedAt,
      subDeleted: userStrategySubscriptions.deletedAt,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .where(eq(userStrategyRuns.id, runId))
    .limit(1);

  if (!r) return { ok: false, reason: "run_not_found" };
  if (r.approval !== "approved") return { ok: false, reason: "user_not_approved" };
  if (r.subDeleted != null) return { ok: false, reason: "subscription_inactive" };
  if (r.subStatus !== "active" || r.accessValidUntil <= now) {
    return { ok: false, reason: "subscription_inactive" };
  }
  if (r.stratDeleted != null || r.stratStatus !== "active") {
    return { ok: false, reason: "strategy_inactive" };
  }
  if (r.runStatus !== "active") {
    if (
      r.runStatus === "blocked_revenue_due" ||
      r.runStatus === "paused_revenue_due" ||
      r.runStatus === "paused_admin"
    ) {
      return { ok: false, reason: "revenue_or_pause_block" };
    }
    return { ok: false, reason: "run_not_active" };
  }
  if (
    r.capitalToUseInr == null ||
    r.leverage == null ||
    String(r.capitalToUseInr).trim() === "" ||
    String(r.leverage).trim() === ""
  ) {
    return { ok: false, reason: "settings_incomplete" };
  }

  const [ec] = await db
    .selectDistinctOn([exchangeConnections.userId], {
      id: exchangeConnections.id,
      status: exchangeConnections.status,
      lastTestStatus: exchangeConnections.lastTestStatus,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, r.userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
        eq(exchangeConnections.status, "active"),
        eq(exchangeConnections.lastTestStatus, "success"),
        hasKeysExpr,
      ),
    )
    .orderBy(
      exchangeConnections.userId,
      desc(exchangeConnections.updatedAt),
    )
    .limit(1);

  if (!ec) {
    return { ok: false, reason: "exchange_not_ready" };
  }

  return {
    ok: true,
    row: {
      userId: r.userId,
      subscriptionId: r.subscriptionId,
      runId: r.runId,
      strategyId: r.strategyId,
      exchangeConnectionId: ec.id,
      capitalToUseInr: String(r.capitalToUseInr),
      leverage: String(r.leverage),
    },
  };
}
