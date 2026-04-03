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
  users,
} from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { ADMIN_FORCE_PAUSE_SOURCE_STATUSES } from "@/lib/admin-strategy-run";
import { hasValidDeltaIndiaConnectionForTrading } from "@/server/queries/exchange-valid-for-trading";
import { subscriptionHasBlockingOverdueLedger } from "@/server/revenue/revenue-due-gate";

const MS_PER_DAY = 86_400_000;

const uuid = z.string().uuid();

export type AdminUserStrategyControlState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

function revalidateStrategySurfaces(userId: string, strategySlug: string) {
  revalidatePath("/admin/user-strategies");
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/user/my-strategies");
  revalidatePath(
    `/user/my-strategies/${encodeURIComponent(strategySlug)}/settings`,
  );
}

function numericFieldPresent(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return String(raw).trim() !== "";
}

function subscriptionActiveEntitled(
  status: string,
  accessValidUntil: Date,
  now: Date,
): boolean {
  return status === "active" && accessValidUntil.getTime() > now.getTime();
}

async function loadRunBundleByRunId(database: ReturnType<typeof requireDb>, runId: string) {
  const [row] = await database
    .select({
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
      subscriptionId: userStrategySubscriptions.id,
      targetUserId: userStrategySubscriptions.userId,
      subStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      strategySlug: strategies.slug,
      strategyName: strategies.name,
      strategyStatus: strategies.status,
      strategyDeletedAt: strategies.deletedAt,
      userApproval: users.approvalStatus,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .where(
      and(
        eq(userStrategyRuns.id, runId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function adminForcePauseRunFormAction(
  _prev: AdminUserStrategyControlState,
  formData: FormData,
): Promise<AdminUserStrategyControlState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const runIdRaw = formData.get("runId");
  const notesRaw = formData.get("adminNotes");
  const parsed = z
    .object({
      runId: uuid,
      adminNotes: z.string().trim().min(1).max(2000),
    })
    .safeParse({
      runId: typeof runIdRaw === "string" ? runIdRaw : "",
      adminNotes: typeof notesRaw === "string" ? notesRaw : "",
    });

  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return {
      ok: false,
      message: f.runId?.[0] ?? f.adminNotes?.[0] ?? "Invalid input.",
    };
  }

  const database = requireDb();
  const now = new Date();
  const row = await loadRunBundleByRunId(database, parsed.data.runId);

  if (!row) {
    return { ok: false, message: "Run not found." };
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

  const prevStatus = row.runStatus;

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
      action: "admin.run_force_paused",
      entityType: "user_strategy_run",
      entityId: row.runId,
      metadata: {
        admin_note: parsed.data.adminNotes,
        subscription_id: row.subscriptionId,
        target_user_id: row.targetUserId,
        strategy_slug: row.strategySlug,
        old_values: { run_status: prevStatus },
        new_values: { run_status: "paused_admin" as const },
      },
    });
  });

  revalidateStrategySurfaces(row.targetUserId, row.strategySlug);
  return { ok: true, message: "Run force-paused." };
}

export async function adminResumeRunFormAction(
  _prev: AdminUserStrategyControlState,
  formData: FormData,
): Promise<AdminUserStrategyControlState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const runIdRaw = formData.get("runId");
  const notesRaw = formData.get("adminNotes");
  const parsed = z
    .object({
      runId: uuid,
      adminNotes: z.string().trim().min(1).max(2000),
    })
    .safeParse({
      runId: typeof runIdRaw === "string" ? runIdRaw : "",
      adminNotes: typeof notesRaw === "string" ? notesRaw : "",
    });

  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return {
      ok: false,
      message: f.runId?.[0] ?? f.adminNotes?.[0] ?? "Invalid input.",
    };
  }

  const database = requireDb();
  const now = new Date();
  const row = await loadRunBundleByRunId(database, parsed.data.runId);

  if (!row) {
    return { ok: false, message: "Run not found." };
  }

  if (row.runStatus !== "paused_admin") {
    return {
      ok: false,
      message: "Only runs in paused_admin can be resumed by admin.",
    };
  }

  const blocking = await subscriptionHasBlockingOverdueLedger(row.subscriptionId);
  if (blocking) {
    return {
      ok: false,
      message:
        "This subscription still has overdue revenue-share debt. Resolve billing before resuming.",
    };
  }

  if (row.userApproval !== "approved") {
    return {
      ok: false,
      message: "User account is not approved; cannot resume run.",
    };
  }

  if (!subscriptionActiveEntitled(row.subStatus, row.accessValidUntil, now)) {
    return {
      ok: false,
      message: "Subscription is not active with valid access.",
    };
  }

  if (row.strategyDeletedAt != null || row.strategyStatus !== "active") {
    return {
      ok: false,
      message: "Strategy catalog row is not active.",
    };
  }

  if (
    !numericFieldPresent(row.capitalToUseInr) ||
    !numericFieldPresent(row.leverage)
  ) {
    return {
      ok: false,
      message:
        "Capital and leverage must be set on the run before resuming. Use user strategy settings.",
    };
  }

  const exchangeOk = await hasValidDeltaIndiaConnectionForTrading(
    row.targetUserId,
  );
  if (!exchangeOk) {
    return {
      ok: false,
      message:
        "Delta India connection is not active with saved keys and a successful test. Fix exchange settings first; run stays paused_admin.",
    };
  }

  await database.transaction(async (tx) => {
    await tx
      .update(userStrategyRuns)
      .set({
        status: "active",
        activatedAt: now,
        pausedAt: null,
        lastStateReason: null,
        updatedAt: now,
      })
      .where(eq(userStrategyRuns.id, row.runId));

    await tx.insert(auditLogs).values({
      actorType: "admin",
      actorAdminId: adminId,
      action: "admin.run_resumed",
      entityType: "user_strategy_run",
      entityId: row.runId,
      metadata: {
        admin_note: parsed.data.adminNotes,
        subscription_id: row.subscriptionId,
        target_user_id: row.targetUserId,
        strategy_slug: row.strategySlug,
        old_values: { run_status: "paused_admin" as const },
        new_values: { run_status: "active" as const },
      },
    });
  });

  revalidateStrategySurfaces(row.targetUserId, row.strategySlug);
  return { ok: true, message: "Run resumed to active." };
}

export async function adminExtendSubscriptionFormAction(
  _prev: AdminUserStrategyControlState,
  formData: FormData,
): Promise<AdminUserStrategyControlState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const subRaw = formData.get("subscriptionId");
  const daysRaw = formData.get("addDays");
  const parsed = z
    .object({
      subscriptionId: uuid,
      addDays: z.coerce.number().int().min(1).max(3650),
    })
    .safeParse({
      subscriptionId: typeof subRaw === "string" ? subRaw : "",
      addDays: typeof daysRaw === "string" ? daysRaw : "",
    });

  if (!parsed.success) {
    return {
      ok: false,
      message: "subscriptionId and addDays (1–3650) are required.",
    };
  }

  const database = requireDb();
  const now = new Date();

  const [row] = await database
    .select({
      subscriptionId: userStrategySubscriptions.id,
      userId: userStrategySubscriptions.userId,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      strategySlug: strategies.slug,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.id, parsed.data.subscriptionId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "Subscription not found." };
  }

  const prevUntil = row.accessValidUntil;
  const anchor = Math.max(now.getTime(), prevUntil.getTime());
  const nextUntil = new Date(anchor + parsed.data.addDays * MS_PER_DAY);

  await database.transaction(async (tx) => {
    await tx
      .update(userStrategySubscriptions)
      .set({
        accessValidUntil: nextUntil,
        updatedAt: now,
      })
      .where(eq(userStrategySubscriptions.id, row.subscriptionId));

    await tx.insert(auditLogs).values({
      actorType: "admin",
      actorAdminId: adminId,
      action: "admin.subscription_extended",
      entityType: "user_strategy_subscription",
      entityId: row.subscriptionId,
      metadata: {
        target_user_id: row.userId,
        add_days: parsed.data.addDays,
        old_values: { access_valid_until: prevUntil.toISOString() },
        new_values: { access_valid_until: nextUntil.toISOString() },
      },
    });
  });

  revalidateStrategySurfaces(row.userId, row.strategySlug);
  revalidatePath(`/admin/user-strategies/${row.subscriptionId}`);
  return {
    ok: true,
    message: `Extended access by ${parsed.data.addDays} day(s).`,
  };
}
