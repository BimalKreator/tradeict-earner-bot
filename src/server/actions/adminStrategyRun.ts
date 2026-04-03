"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminId } from "@/server/auth/require-admin-id";
import {
  auditLogs,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { ADMIN_FORCE_PAUSE_SOURCE_STATUSES } from "@/lib/admin-strategy-run";

const inputSchema = z.object({
  targetUserId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  adminNote: z.string().trim().min(1, "A note is required.").max(2000),
});

export type AdminForcePauseRunState = {
  ok: boolean | null;
  message: string;
};

export const adminForcePauseRunInitialState: AdminForcePauseRunState = {
  ok: null,
  message: "",
};

export async function adminForcePauseStrategyRunAction(
  _prev: AdminForcePauseRunState,
  formData: FormData,
): Promise<AdminForcePauseRunState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const parsed = inputSchema.safeParse({
    targetUserId: formData.get("targetUserId"),
    subscriptionId: formData.get("subscriptionId"),
    adminNote: formData.get("adminNote"),
  });

  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg =
      first.adminNote?.[0] ??
      first.targetUserId?.[0] ??
      first.subscriptionId?.[0] ??
      "Invalid input.";
    return { ok: false, message: msg };
  }

  const { targetUserId, subscriptionId, adminNote } = parsed.data;
  const database = requireDb();
  const now = new Date();

  const [row] = await database
    .select({
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      strategySlug: strategies.slug,
      strategyName: strategies.name,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.id, subscriptionId),
        eq(userStrategySubscriptions.userId, targetUserId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "Subscription or run not found." };
  }

  if (row.runStatus === "paused_admin") {
    return { ok: false, message: "This run is already admin-paused." };
  }

  if (!ADMIN_FORCE_PAUSE_SOURCE_STATUSES.has(row.runStatus)) {
    return {
      ok: false,
      message: "This run cannot be force-paused from its current state.",
    };
  }

  const previousStatus = row.runStatus;

  await database.transaction(async (tx) => {
    await tx
      .update(userStrategyRuns)
      .set({
        status: "paused_admin",
        pausedAt: now,
        lastStateReason: "admin_force_pause",
        updatedAt: now,
      })
      .where(eq(userStrategyRuns.id, row.runId));

    await tx.insert(auditLogs).values({
      actorType: "admin",
      actorAdminId: adminId,
      action: "strategy_run.admin_force_paused",
      entityType: "user_strategy_run",
      entityId: row.runId,
      metadata: {
        admin_note: adminNote,
        previous_run_status: previousStatus,
        subscription_id: subscriptionId,
        strategy_slug: row.strategySlug,
        strategy_name: row.strategyName,
        target_user_id: targetUserId,
      },
    });
  });

  revalidatePath(`/admin/users/${targetUserId}`);
  revalidatePath("/user/my-strategies");

  return { ok: true, message: "Run force-paused." };
}
