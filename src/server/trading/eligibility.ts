import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  exchangeConnections,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
} from "@/server/db/schema";
import { getGlobalEmergencyStopActive } from "@/server/platform/global-emergency-stop";

export type EligibleStrategyRunRow = {
  userId: string;
  subscriptionId: string;
  runId: string;
  strategyId: string;
  exchangeConnectionId: string;
  capitalToUseInr: string;
  /** Effective leverage for execution (capped to `strategies.max_leverage` when set). */
  leverage: string;
  /** True when run leverage in DB exceeded strategy max and was clamped for execution. */
  leverageCapped?: boolean;
};

function parsePositiveNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Enforces strategy.max_leverage at execution time: if the user run exceeds the cap,
 * the effective leverage is the strategy maximum (no DB mutation here).
 */
export function effectiveLeverageForExecution(
  runLeverageStr: string,
  strategyMaxLeverageRaw: string | null | undefined,
): { leverage: string; capped: boolean } {
  const userLev = parsePositiveNum(runLeverageStr);
  const maxLev = parsePositiveNum(
    strategyMaxLeverageRaw != null ? String(strategyMaxLeverageRaw) : null,
  );
  if (userLev == null) {
    return { leverage: runLeverageStr, capped: false };
  }
  if (maxLev == null || userLev <= maxLev) {
    return { leverage: runLeverageStr, capped: false };
  }
  return { leverage: String(maxLev), capped: true };
}

const hasKeysExpr = sql`(
  length(trim(coalesce(${exchangeConnections.apiKeyCiphertext}, ''))) > 0
  and length(trim(coalesce(${exchangeConnections.apiSecretCiphertext}, ''))) > 0
)`;

/**
 * Runs that may execute trades for a strategy: approved user, active subscription,
 * strategy `active`, latest Delta connection on + tested + keys, capital/leverage set.
 *
 * Run status:
 * - `signalAction === "entry"` (default): only `active` runs.
 * - `signalAction === "exit"`: `active` or `blocked_revenue_due` (close positions while billing block is on).
 */
export async function findEligibleRunsForStrategyExecution(
  strategyId: string,
  options?: {
    targetUserIds?: string[];
    signalAction?: "entry" | "exit";
  },
): Promise<EligibleStrategyRunRow[]> {
  if (!db) return [];

  if (await getGlobalEmergencyStopActive()) {
    return [];
  }

  const now = new Date();
  const action = options?.signalAction ?? "entry";

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

  const runStatusFilter =
    action === "exit"
      ? inArray(userStrategyRuns.status, ["active", "blocked_revenue_due"])
      : eq(userStrategyRuns.status, "active");

  const filters = [
    eq(strategies.id, strategyId),
    runStatusFilter,
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
      strategyMaxLeverage: strategies.maxLeverage,
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

  return rows.map((r) => {
    const { leverage, capped } = effectiveLeverageForExecution(
      String(r.leverage),
      r.strategyMaxLeverage != null ? String(r.strategyMaxLeverage) : null,
    );
    return {
      userId: r.userId,
      subscriptionId: r.subscriptionId,
      runId: r.runId,
      strategyId: r.strategyId,
      exchangeConnectionId: r.exchangeConnectionId,
      capitalToUseInr: String(r.capitalToUseInr),
      leverage,
      ...(capped ? { leverageCapped: true } : {}),
    };
  });
}

export type ExecutionEligibilityFailure =
  | "run_not_found"
  | "user_not_approved"
  | "subscription_inactive"
  | "strategy_inactive"
  | "run_not_active"
  | "revenue_or_pause_block"
  | "blocked_revenue_entry"
  | "exchange_not_ready"
  | "settings_incomplete"
  | "global_emergency_stop";

/**
 * Re-check a single run immediately before placing an order (worker safety).
 */
export async function assertRunStillEligibleForExecution(
  runId: string,
  opts?: { signalAction?: "entry" | "exit" },
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
      strategyMaxLeverage: strategies.maxLeverage,
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

  const signalAction = opts?.signalAction ?? "entry";

  if (!r) return { ok: false, reason: "run_not_found" };

  if (await getGlobalEmergencyStopActive()) {
    return { ok: false, reason: "global_emergency_stop" };
  }

  if (r.approval !== "approved") return { ok: false, reason: "user_not_approved" };
  if (r.subDeleted != null) return { ok: false, reason: "subscription_inactive" };
  if (r.subStatus !== "active" || r.accessValidUntil <= now) {
    return { ok: false, reason: "subscription_inactive" };
  }
  if (r.stratDeleted != null || r.stratStatus !== "active") {
    return { ok: false, reason: "strategy_inactive" };
  }

  if (r.runStatus === "blocked_revenue_due") {
    if (signalAction === "exit") {
      /* fall through — exits are allowed to flatten risk */
    } else {
      return { ok: false, reason: "blocked_revenue_entry" };
    }
  } else if (r.runStatus !== "active") {
    if (
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

  const levEff = effectiveLeverageForExecution(
    String(r.leverage),
    r.strategyMaxLeverage != null ? String(r.strategyMaxLeverage) : null,
  );

  return {
    ok: true,
    row: {
      userId: r.userId,
      subscriptionId: r.subscriptionId,
      runId: r.runId,
      strategyId: r.strategyId,
      exchangeConnectionId: ec.id,
      capitalToUseInr: String(r.capitalToUseInr),
      leverage: levEff.leverage,
      ...(levEff.capped ? { leverageCapped: true } : {}),
    },
  };
}
