import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  strategies,
  users,
  virtualStrategyRuns,
} from "@/server/db/schema";
import { getGlobalEmergencyStopActive } from "@/server/platform/global-emergency-stop";

import { effectiveLeverageForExecution } from "./eligibility";

export type EligibleVirtualRunRow = {
  userId: string;
  virtualRunId: string;
  strategyId: string;
  virtualCapitalUsd: string;
  leverage: string;
  leverageCapped?: boolean;
};

function parsePositiveNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Paper runs that mirror live signal fan-out: approved user, active strategy,
 * active virtual run with capital + leverage. No subscription or exchange checks.
 */
export async function findEligibleVirtualRunsForStrategyExecution(
  strategyId: string,
  options?: {
    targetUserIds?: string[];
    signalAction?: "entry" | "exit";
  },
): Promise<EligibleVirtualRunRow[]> {
  if (!db) return [];

  if (await getGlobalEmergencyStopActive()) {
    return [];
  }

  const action = options?.signalAction ?? "entry";
  const statusFilter =
    action === "exit"
      ? inArray(virtualStrategyRuns.status, ["active", "paused"])
      : eq(virtualStrategyRuns.status, "active");

  const filters = [
    eq(virtualStrategyRuns.strategyId, strategyId),
    statusFilter,
    eq(users.approvalStatus, "approved"),
    isNull(users.deletedAt),
    eq(strategies.status, "active"),
    isNull(strategies.deletedAt),
    sql`cast(${virtualStrategyRuns.virtualCapitalUsd} as numeric) > 0`,
    sql`${virtualStrategyRuns.leverage} is not null`,
    sql`trim(coalesce(cast(${virtualStrategyRuns.leverage} as text), '')) <> ''`,
  ];

  if (options?.targetUserIds?.length) {
    filters.push(inArray(users.id, options.targetUserIds));
  }

  const rows = await db
    .select({
      userId: virtualStrategyRuns.userId,
      virtualRunId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      virtualCapitalUsd: virtualStrategyRuns.virtualCapitalUsd,
      leverage: virtualStrategyRuns.leverage,
      strategyMaxLeverage: strategies.maxLeverage,
    })
    .from(virtualStrategyRuns)
    .innerJoin(users, eq(virtualStrategyRuns.userId, users.id))
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(and(...filters));

  return rows.map((r) => {
    const { leverage, capped } = effectiveLeverageForExecution(
      String(r.leverage),
      r.strategyMaxLeverage != null ? String(r.strategyMaxLeverage) : null,
    );
    return {
      userId: r.userId,
      virtualRunId: r.virtualRunId,
      strategyId: r.strategyId,
      virtualCapitalUsd: String(r.virtualCapitalUsd),
      leverage,
      ...(capped ? { leverageCapped: true } : {}),
    };
  });
}

export type VirtualExecutionEligibilityFailure =
  | "run_not_found"
  | "user_not_approved"
  | "strategy_inactive"
  | "run_not_active"
  | "global_emergency_stop"
  | "settings_incomplete";

export async function assertVirtualRunStillEligibleForExecution(
  virtualRunId: string,
  opts?: { signalAction?: "entry" | "exit" },
): Promise<
  | { ok: true; row: EligibleVirtualRunRow }
  | { ok: false; reason: VirtualExecutionEligibilityFailure }
> {
  if (!db) return { ok: false, reason: "run_not_found" };

  const [r] = await db
    .select({
      userId: virtualStrategyRuns.userId,
      virtualRunId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      runStatus: virtualStrategyRuns.status,
      leverage: virtualStrategyRuns.leverage,
      virtualCapitalUsd: virtualStrategyRuns.virtualCapitalUsd,
      approval: users.approvalStatus,
      stratStatus: strategies.status,
      stratDeleted: strategies.deletedAt,
      strategyMaxLeverage: strategies.maxLeverage,
    })
    .from(virtualStrategyRuns)
    .innerJoin(users, eq(virtualStrategyRuns.userId, users.id))
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(eq(virtualStrategyRuns.id, virtualRunId))
    .limit(1);

  const signalAction = opts?.signalAction ?? "entry";

  if (!r) return { ok: false, reason: "run_not_found" };

  if (await getGlobalEmergencyStopActive()) {
    return { ok: false, reason: "global_emergency_stop" };
  }

  if (r.approval !== "approved") return { ok: false, reason: "user_not_approved" };
  if (r.stratDeleted != null || r.stratStatus !== "active") {
    return { ok: false, reason: "strategy_inactive" };
  }

  if (r.runStatus !== "active") {
    if (signalAction === "exit" && r.runStatus === "paused") {
      /* allow risk-reducing exits while paused */
    } else {
      return { ok: false, reason: "run_not_active" };
    }
  }

  const cap = parsePositiveNum(String(r.virtualCapitalUsd ?? ""));
  const lev = parsePositiveNum(String(r.leverage ?? ""));
  if (cap == null || lev == null) {
    return { ok: false, reason: "settings_incomplete" };
  }

  const levEff = effectiveLeverageForExecution(
    String(r.leverage),
    r.strategyMaxLeverage != null ? String(r.strategyMaxLeverage) : null,
  );

  return {
    ok: true,
    row: {
      userId: r.userId,
      virtualRunId: r.virtualRunId,
      strategyId: r.strategyId,
      virtualCapitalUsd: String(r.virtualCapitalUsd),
      leverage: levEff.leverage,
      ...(levEff.capped ? { leverageCapped: true } : {}),
    },
  };
}
