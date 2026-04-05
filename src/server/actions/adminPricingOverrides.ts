"use server";

import { and, eq, gt, isNull, lte, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminId } from "@/server/auth/require-admin-id";
import type { Database } from "@/server/db";
import { logAdminAction } from "@/server/audit/audit-logger";
import { strategies, userStrategyPricingOverrides } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

const uuid = z.string().uuid();

export type AdminPricingOverrideFormState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

function revalidatePricingSurfaces(userId: string, strategySlug?: string) {
  revalidatePath("/admin/strategies");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath(`/admin/users/${userId}/pricing`);
  revalidatePath("/user/strategies");
  if (strategySlug) {
    revalidatePath(`/user/strategies/${strategySlug}/checkout`);
  }
}

function parseMoneyOrNull(s: string | undefined): string | null {
  if (s == null || !String(s).trim()) return null;
  const n = Number(String(s).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function parsePercentOrNull(s: string | undefined): string | null {
  if (s == null || !String(s).trim()) return null;
  const n = Number(String(s).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n.toFixed(2);
}

function snapshotFromRow(r: {
  id: string;
  userId: string;
  strategyId: string;
  monthlyFeeInrOverride: string | null;
  revenueSharePercentOverride: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  isActive: boolean;
  adminNotes: string | null;
}) {
  return {
    id: r.id,
    user_id: r.userId,
    strategy_id: r.strategyId,
    monthly_fee_inr_override: r.monthlyFeeInrOverride,
    revenue_share_percent_override: r.revenueSharePercentOverride,
    effective_from: r.effectiveFrom.toISOString(),
    effective_until: r.effectiveUntil?.toISOString() ?? null,
    is_active: r.isActive,
    admin_notes: r.adminNotes,
  };
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function closeOpenActiveWindows(
  tx: Tx,
  args: {
    userId: string;
    strategyId: string;
    newEffectiveFrom: Date;
    excludeOverrideId?: string;
  },
) {
  const conds = [
    eq(userStrategyPricingOverrides.userId, args.userId),
    eq(userStrategyPricingOverrides.strategyId, args.strategyId),
    eq(userStrategyPricingOverrides.isActive, true),
    lte(userStrategyPricingOverrides.effectiveFrom, args.newEffectiveFrom),
    or(
      isNull(userStrategyPricingOverrides.effectiveUntil),
      gt(userStrategyPricingOverrides.effectiveUntil, args.newEffectiveFrom),
    ),
  ];
  if (args.excludeOverrideId) {
    conds.push(ne(userStrategyPricingOverrides.id, args.excludeOverrideId));
  }
  await tx
    .update(userStrategyPricingOverrides)
    .set({ effectiveUntil: args.newEffectiveFrom })
    .where(and(...conds));
}

export async function adminCreatePricingOverrideFormAction(
  _prev: AdminPricingOverrideFormState,
  formData: FormData,
): Promise<AdminPricingOverrideFormState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const targetUserIdRaw = formData.get("targetUserId");
  const strategyIdRaw = formData.get("strategyId");
  const feeRaw = formData.get("monthlyFeeInr");
  const pctRaw = formData.get("revenueSharePercent");
  const effRaw = formData.get("effectiveFrom");
  const notesRaw = formData.get("adminNotes");
  const activeRaw = formData.get("isActive");

  const parsed = z
    .object({
      targetUserId: uuid,
      strategyId: uuid,
      monthlyFeeInr: z.string().optional(),
      revenueSharePercent: z.string().optional(),
      effectiveFrom: z.string().optional(),
      adminNotes: z.string().max(5000).optional(),
      isActive: z.enum(["on", "off"]).optional(),
    })
    .safeParse({
      targetUserId:
        typeof targetUserIdRaw === "string" ? targetUserIdRaw : "",
      strategyId: typeof strategyIdRaw === "string" ? strategyIdRaw : "",
      monthlyFeeInr: typeof feeRaw === "string" ? feeRaw : undefined,
      revenueSharePercent: typeof pctRaw === "string" ? pctRaw : undefined,
      effectiveFrom: typeof effRaw === "string" ? effRaw : undefined,
      adminNotes: typeof notesRaw === "string" ? notesRaw : undefined,
      isActive: activeRaw === "on" ? "on" : "off",
    });

  if (!parsed.success) {
    return { ok: false, message: "Invalid form data." };
  }

  const fee = parseMoneyOrNull(parsed.data.monthlyFeeInr);
  const pct = parsePercentOrNull(parsed.data.revenueSharePercent);
  if (fee == null && pct == null) {
    return {
      ok: false,
      message:
        "Set at least one field: monthly fee (₹0 allowed) and/or revenue share % (0–100, 0% allowed).",
    };
  }

  let effectiveFrom = new Date();
  if (parsed.data.effectiveFrom?.trim()) {
    const d = new Date(parsed.data.effectiveFrom.trim());
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: "Invalid effective from date." };
    }
    effectiveFrom = d;
  }

  const isActive = parsed.data.isActive !== "off";
  const adminNotes =
    parsed.data.adminNotes?.trim() ? parsed.data.adminNotes.trim() : null;

  const database = requireDb();

  const [strat] = await database
    .select({ slug: strategies.slug })
    .from(strategies)
    .where(
      and(
        eq(strategies.id, parsed.data.strategyId),
        eq(strategies.status, "active"),
        isNull(strategies.deletedAt),
      ),
    )
    .limit(1);

  if (!strat) {
    return { ok: false, message: "Strategy not found or not active." };
  }

  try {
    const inserted = await database.transaction(async (tx) => {
      if (isActive) {
        await closeOpenActiveWindows(tx, {
          userId: parsed.data.targetUserId,
          strategyId: parsed.data.strategyId,
          newEffectiveFrom: effectiveFrom,
        });
      }

      const rows = await tx
        .insert(userStrategyPricingOverrides)
        .values({
          userId: parsed.data.targetUserId,
          strategyId: parsed.data.strategyId,
          monthlyFeeInrOverride: fee,
          revenueSharePercentOverride: pct,
          effectiveFrom,
          effectiveUntil: null,
          isActive,
          adminNotes,
          setByAdminId: adminId,
        })
        .returning({
          id: userStrategyPricingOverrides.id,
          userId: userStrategyPricingOverrides.userId,
          strategyId: userStrategyPricingOverrides.strategyId,
          monthlyFeeInrOverride: userStrategyPricingOverrides.monthlyFeeInrOverride,
          revenueSharePercentOverride:
            userStrategyPricingOverrides.revenueSharePercentOverride,
          effectiveFrom: userStrategyPricingOverrides.effectiveFrom,
          effectiveUntil: userStrategyPricingOverrides.effectiveUntil,
          isActive: userStrategyPricingOverrides.isActive,
          adminNotes: userStrategyPricingOverrides.adminNotes,
        });
      return rows[0];
    });

    if (!inserted) {
      return { ok: false, message: "Insert failed." };
    }

    const snap = snapshotFromRow({
      ...inserted,
      monthlyFeeInrOverride: inserted.monthlyFeeInrOverride
        ? String(inserted.monthlyFeeInrOverride)
        : null,
      revenueSharePercentOverride: inserted.revenueSharePercentOverride
        ? String(inserted.revenueSharePercentOverride)
        : null,
    });
    await logAdminAction({
      actorAdminId: adminId,
      action: "admin.pricing_override_created",
      entityType: "user_strategy_pricing_override",
      entityId: inserted.id,
      newValues: snap as unknown as Record<string, unknown>,
      extra: { target_user_id: inserted.userId },
    });

    revalidatePricingSurfaces(parsed.data.targetUserId, strat.slug);
    return { ok: true, message: "Pricing override created." };
  } catch (e) {
    console.error("[admin] create pricing override", e);
    return { ok: false, message: "Could not save override." };
  }
}

export async function adminUpdatePricingOverrideFormAction(
  _prev: AdminPricingOverrideFormState,
  formData: FormData,
): Promise<AdminPricingOverrideFormState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const idRaw = formData.get("overrideId");
  const targetUserIdRaw = formData.get("targetUserId");
  const feeRaw = formData.get("monthlyFeeInr");
  const pctRaw = formData.get("revenueSharePercent");
  const notesRaw = formData.get("adminNotes");
  const activeRaw = formData.get("isActive");
  const untilRaw = formData.get("effectiveUntil");

  const parsed = z
    .object({
      overrideId: uuid,
      targetUserId: uuid,
      monthlyFeeInr: z.string().optional(),
      revenueSharePercent: z.string().optional(),
      adminNotes: z.string().max(5000).optional(),
      isActive: z.enum(["on", "off"]).optional(),
      effectiveUntil: z.string().optional(),
    })
    .safeParse({
      overrideId: typeof idRaw === "string" ? idRaw : "",
      targetUserId:
        typeof targetUserIdRaw === "string" ? targetUserIdRaw : "",
      monthlyFeeInr: typeof feeRaw === "string" ? feeRaw : undefined,
      revenueSharePercent: typeof pctRaw === "string" ? pctRaw : undefined,
      adminNotes: typeof notesRaw === "string" ? notesRaw : undefined,
      isActive: activeRaw === "on" ? "on" : "off",
      effectiveUntil: typeof untilRaw === "string" ? untilRaw : undefined,
    });

  if (!parsed.success) {
    return { ok: false, message: "Invalid form data." };
  }

  const fee = parseMoneyOrNull(parsed.data.monthlyFeeInr);
  const pct = parsePercentOrNull(parsed.data.revenueSharePercent);
  if (fee == null && pct == null) {
    return {
      ok: false,
      message:
        "Set at least one field: monthly fee (₹0 allowed) and/or revenue share % (0–100, 0% allowed).",
    };
  }

  const isActive = parsed.data.isActive !== "off";
  const adminNotes =
    parsed.data.adminNotes?.trim() ? parsed.data.adminNotes.trim() : null;

  let effectiveUntil: Date | null = null;
  if (parsed.data.effectiveUntil?.trim()) {
    const d = new Date(parsed.data.effectiveUntil.trim());
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: "Invalid effective until date." };
    }
    effectiveUntil = d;
  }

  const database = requireDb();

  const [before] = await database
    .select()
    .from(userStrategyPricingOverrides)
    .where(
      and(
        eq(userStrategyPricingOverrides.id, parsed.data.overrideId),
        eq(userStrategyPricingOverrides.userId, parsed.data.targetUserId),
      ),
    )
    .limit(1);

  if (!before) {
    return { ok: false, message: "Override not found." };
  }

  const [strat] = await database
    .select({ slug: strategies.slug })
    .from(strategies)
    .where(eq(strategies.id, before.strategyId))
    .limit(1);

  const beforeSnap = snapshotFromRow({
    id: before.id,
    userId: before.userId,
    strategyId: before.strategyId,
    monthlyFeeInrOverride: before.monthlyFeeInrOverride
      ? String(before.monthlyFeeInrOverride)
      : null,
    revenueSharePercentOverride: before.revenueSharePercentOverride
      ? String(before.revenueSharePercentOverride)
      : null,
    effectiveFrom: before.effectiveFrom,
    effectiveUntil: before.effectiveUntil,
    isActive: before.isActive,
    adminNotes: before.adminNotes,
  });

  try {
    await database.transaction(async (tx) => {
      if (isActive && !before.isActive) {
        await closeOpenActiveWindows(tx, {
          userId: before.userId,
          strategyId: before.strategyId,
          newEffectiveFrom: before.effectiveFrom,
          excludeOverrideId: before.id,
        });
      }

      await tx
        .update(userStrategyPricingOverrides)
        .set({
          monthlyFeeInrOverride: fee,
          revenueSharePercentOverride: pct,
          effectiveUntil,
          isActive,
          adminNotes,
          setByAdminId: adminId,
        })
        .where(eq(userStrategyPricingOverrides.id, before.id));
    });

    const [after] = await database
      .select()
      .from(userStrategyPricingOverrides)
      .where(eq(userStrategyPricingOverrides.id, before.id))
      .limit(1);

    const afterSnap = after
      ? snapshotFromRow({
          id: after.id,
          userId: after.userId,
          strategyId: after.strategyId,
          monthlyFeeInrOverride: after.monthlyFeeInrOverride
            ? String(after.monthlyFeeInrOverride)
            : null,
          revenueSharePercentOverride: after.revenueSharePercentOverride
            ? String(after.revenueSharePercentOverride)
            : null,
          effectiveFrom: after.effectiveFrom,
          effectiveUntil: after.effectiveUntil,
          isActive: after.isActive,
          adminNotes: after.adminNotes,
        })
      : beforeSnap;

    await logAdminAction({
      actorAdminId: adminId,
      action: "admin.pricing_override_updated",
      entityType: "user_strategy_pricing_override",
      entityId: before.id,
      oldValues: beforeSnap as unknown as Record<string, unknown>,
      newValues: afterSnap as unknown as Record<string, unknown>,
      extra: { target_user_id: parsed.data.targetUserId },
    });

    revalidatePricingSurfaces(parsed.data.targetUserId, strat?.slug);
    return { ok: true, message: "Override updated." };
  } catch (e) {
    console.error("[admin] update pricing override", e);
    return { ok: false, message: "Could not update override." };
  }
}

export async function adminDeletePricingOverrideFormAction(
  _prev: AdminPricingOverrideFormState,
  formData: FormData,
): Promise<AdminPricingOverrideFormState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const idRaw = formData.get("overrideId");
  const targetUserIdRaw = formData.get("targetUserId");
  const parsed = z
    .object({ overrideId: uuid, targetUserId: uuid })
    .safeParse({
      overrideId: typeof idRaw === "string" ? idRaw : "",
      targetUserId:
        typeof targetUserIdRaw === "string" ? targetUserIdRaw : "",
    });

  if (!parsed.success) {
    return { ok: false, message: "Invalid request." };
  }

  const database = requireDb();

  const [row] = await database
    .select()
    .from(userStrategyPricingOverrides)
    .where(
      and(
        eq(userStrategyPricingOverrides.id, parsed.data.overrideId),
        eq(userStrategyPricingOverrides.userId, parsed.data.targetUserId),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "Override not found." };
  }

  const [strat] = await database
    .select({ slug: strategies.slug })
    .from(strategies)
    .where(eq(strategies.id, row.strategyId))
    .limit(1);

  const beforeSnap = snapshotFromRow({
    id: row.id,
    userId: row.userId,
    strategyId: row.strategyId,
    monthlyFeeInrOverride: row.monthlyFeeInrOverride
      ? String(row.monthlyFeeInrOverride)
      : null,
    revenueSharePercentOverride: row.revenueSharePercentOverride
      ? String(row.revenueSharePercentOverride)
      : null,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    isActive: row.isActive,
    adminNotes: row.adminNotes,
  });

  await database
    .delete(userStrategyPricingOverrides)
    .where(eq(userStrategyPricingOverrides.id, row.id));

  await logAdminAction({
    actorAdminId: adminId,
    action: "admin.pricing_override_deleted",
    entityType: "user_strategy_pricing_override",
    entityId: row.id,
    oldValues: beforeSnap as unknown as Record<string, unknown>,
    extra: { target_user_id: parsed.data.targetUserId, deleted: true },
  });

  revalidatePricingSurfaces(parsed.data.targetUserId, strat?.slug);
  return { ok: true, message: "Override deleted." };
}
