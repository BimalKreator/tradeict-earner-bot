import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db";
import {
  admins,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
} from "@/server/db/schema";
import {
  getGlobalEmergencyStopDetails,
  type GlobalEmergencyStopPayload,
} from "@/server/platform/global-emergency-stop";

export type AdminRiskAttentionRunRow = {
  runId: string;
  subscriptionId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  strategyName: string;
  strategySlug: string;
  runStatus: string;
  pausedAt: Date | null;
  lastStateReason: string | null;
};

export type AdminRiskPageData = {
  emergency: GlobalEmergencyStopPayload;
  attentionRuns: AdminRiskAttentionRunRow[];
  viewerRole: "super_admin" | "staff" | null;
};

export async function getAdminRoleById(
  adminId: string,
): Promise<"super_admin" | "staff" | null> {
  if (!db) return null;
  const [row] = await db
    .select({ role: admins.role })
    .from(admins)
    .where(eq(admins.id, adminId))
    .limit(1);
  if (!row) return null;
  return row.role;
}

/**
 * Runs admins should review for user outreach: insufficient funds auto-pause and exchange-off pauses.
 */
export async function listAdminRiskAttentionRuns(): Promise<
  AdminRiskAttentionRunRow[]
> {
  if (!db) return [];

  const rows = await db
    .select({
      runId: userStrategyRuns.id,
      subscriptionId: userStrategySubscriptions.id,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      runStatus: userStrategyRuns.status,
      pausedAt: userStrategyRuns.pausedAt,
      lastStateReason: userStrategyRuns.lastStateReason,
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
    .where(
      inArray(userStrategyRuns.status, [
        "paused_insufficient_funds",
        "paused_exchange_off",
      ]),
    )
    .orderBy(desc(userStrategyRuns.pausedAt));

  return rows;
}

export async function getAdminRiskPageData(
  viewerAdminId: string | null,
): Promise<AdminRiskPageData | null> {
  if (!db) return null;
  const [emergency, attentionRuns, viewerRole] = await Promise.all([
    getGlobalEmergencyStopDetails(),
    listAdminRiskAttentionRuns(),
    viewerAdminId ? getAdminRoleById(viewerAdminId) : Promise.resolve(null),
  ]);
  return {
    emergency: emergency ?? { active: false },
    attentionRuns,
    viewerRole,
  };
}
