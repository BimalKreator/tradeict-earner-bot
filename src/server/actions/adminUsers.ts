"use server";

import { randomBytes } from "crypto";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logAdminAction } from "@/server/audit/audit-logger";
import { requireAdminId } from "@/server/auth/require-admin-id";
import type { Database } from "@/server/db";
import { users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import {
  adminCreatedUserCredentialsEmail,
  approvalSuccessEmail,
  rejectionEmail,
} from "@/server/email/templates";
import { sendTransactionalEmail } from "@/server/email/send-email";

const uuid = z.string().uuid();

async function insertUserAudit(
  adminId: string,
  action: string,
  userId: string,
  metadata?: Record<string, unknown>,
) {
  await logAdminAction({
    actorAdminId: adminId,
    action,
    entityType: "user",
    entityId: userId,
    extra: metadata,
  });
}

function revalidateUserAdminPaths(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/dashboard");
}

function generateTemporaryPassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@%^*";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 14; i++) {
    out += chars[bytes[i]! % chars.length]!;
  }
  return out;
}

export async function approveUserAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const userId = formData.get("userId");
  const parsed = uuid.safeParse(userId);
  if (!parsed.success) return { error: "Invalid user." };

  const database = requireDb();
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, parsed.data))
    .limit(1);

  if (!user || user.deletedAt) return { error: "User not found." };

  if (
    user.approvalStatus !== "pending_approval" &&
    user.approvalStatus !== "paused"
  ) {
    return { error: "User cannot be approved from the current status." };
  }

  const fromStatus = user.approvalStatus;
  const now = new Date();
  await database
    .update(users)
    .set({
      approvalStatus: "approved",
      approvedAt: now,
      approvedByAdminId: adminId,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  await insertUserAudit(adminId, "user.approved", user.id, {
    email: user.email,
    fromStatus,
  });

  const body = approvalSuccessEmail({ name: user.name });
  await sendTransactionalEmail({
    to: user.email,
    templateKey: "admin.account_approved",
    subject: body.subject,
    text: body.text,
    html: body.html,
    userId: user.id,
  });

  revalidateUserAdminPaths(user.id);
  return { ok: true as const };
}

export async function rejectUserAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const userId = formData.get("userId");
  const note = formData.get("note");
  const parsed = uuid.safeParse(userId);
  if (!parsed.success) return { error: "Invalid user." };

  const database = requireDb();
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, parsed.data))
    .limit(1);

  if (!user || user.deletedAt) return { error: "User not found." };
  if (user.approvalStatus !== "pending_approval") {
    return { error: "User is not pending approval." };
  }

  const noteStr =
    typeof note === "string" && note.trim() ? note.trim() : undefined;
  const now = new Date();

  await database
    .update(users)
    .set({
      approvalStatus: "rejected",
      approvalNotes: noteStr ?? null,
      approvedByAdminId: adminId,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  await insertUserAudit(adminId, "user.rejected", user.id, {
    email: user.email,
    note: noteStr,
  });

  const body = rejectionEmail({ name: user.name, note: noteStr });
  await sendTransactionalEmail({
    to: user.email,
    templateKey: "admin.account_rejected",
    subject: body.subject,
    text: body.text,
    html: body.html,
    userId: user.id,
    notificationMetadata: { has_note: Boolean(noteStr) },
  });

  revalidateUserAdminPaths(user.id);
  return { ok: true as const };
}

export async function pauseUserAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const userId = formData.get("userId");
  const parsed = uuid.safeParse(userId);
  if (!parsed.success) return { error: "Invalid user." };

  const database = requireDb();
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, parsed.data))
    .limit(1);

  if (!user || user.deletedAt) return { error: "User not found." };
  if (user.approvalStatus === "archived") {
    return { error: "Archived users cannot be paused." };
  }
  if (
    user.approvalStatus !== "approved" &&
    user.approvalStatus !== "pending_approval"
  ) {
    return { error: "Only approved or pending-approval users can be paused." };
  }

  const now = new Date();
  await database
    .update(users)
    .set({
      approvalStatus: "paused",
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  await insertUserAudit(adminId, "user.paused", user.id, {
    email: user.email,
    previousStatus: user.approvalStatus,
  });

  revalidateUserAdminPaths(user.id);
  return { ok: true as const };
}

export async function archiveUserAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const userId = formData.get("userId");
  const parsed = uuid.safeParse(userId);
  if (!parsed.success) return { error: "Invalid user." };

  const database = requireDb();
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, parsed.data))
    .limit(1);

  if (!user || user.deletedAt) return { error: "User not found." };
  if (user.approvalStatus === "archived") {
    return { error: "User is already archived." };
  }

  const previousStatus = user.approvalStatus;
  const now = new Date();
  await database
    .update(users)
    .set({ approvalStatus: "archived", updatedAt: now })
    .where(eq(users.id, user.id));

  await insertUserAudit(adminId, "user.archived", user.id, {
    email: user.email,
    previousStatus,
  });

  revalidateUserAdminPaths(user.id);
  return { ok: true as const };
}

const createUserSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .default("")
    .refine(
      (s) => !s || /^[0-9+\s-]+$/.test(s),
      "Phone should contain digits only",
    ),
});

export type CreateAdminUserState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function createAdminUserAction(
  _prev: CreateAdminUserState,
  formData: FormData,
): Promise<CreateAdminUserState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const database = requireDb();
  const email = parsed.data.email.toLowerCase();
  const phoneRaw = parsed.data.phone?.trim() ?? "";
  const phoneNorm = phoneRaw === "" ? null : phoneRaw.replace(/\s/g, "");
  const plainPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(plainPassword, 12);
  const now = new Date();

  let newId: string;
  try {
    const [row] = await database
      .insert(users)
      .values({
        email,
        name: parsed.data.name,
        phone: phoneNorm,
        passwordHash,
        approvalStatus: "approved",
        approvedAt: now,
        approvedByAdminId: adminId,
        updatedAt: now,
      })
      .returning({ id: users.id });
    newId = row!.id;
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === "23505") {
      return { error: "An account with this email already exists." };
    }
    throw e;
  }

  await insertUserAudit(adminId, "user.created_by_admin", newId, {
    email,
  });

  const body = adminCreatedUserCredentialsEmail({
    name: parsed.data.name,
    email,
    temporaryPassword: plainPassword,
  });
  const sendResult = await sendTransactionalEmail({
    to: email,
    templateKey: "auth.admin_created_account",
    subject: body.subject,
    text: body.text,
    html: body.html,
    userId: newId,
  });

  revalidateUserAdminPaths(newId);
  if (!sendResult.ok) {
    redirect(`/admin/users/${newId}?email_delivery=failed`);
  }
  redirect(`/admin/users/${newId}`);
}

const updateBasicSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .default("")
    .transform((s) => (s === "" ? null : s.replace(/\s/g, "")))
    .refine(
      (s) => s === null || /^[0-9+-]+$/.test(s),
      "Phone should contain digits only",
    ),
});

export type UpdateUserBasicState = { ok?: true; error?: string; fieldErrors?: Record<string, string[]> };

export async function updateUserBasicAction(
  _prev: UpdateUserBasicState,
  formData: FormData,
): Promise<UpdateUserBasicState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const parsed = updateBasicSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const database = requireDb();
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);

  if (!user || user.deletedAt) return { error: "User not found." };

  const now = new Date();
  await database
    .update(users)
    .set({
      name: parsed.data.name,
      phone: parsed.data.phone,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  await insertUserAudit(adminId, "user.profile_updated", user.id, {
    email: user.email,
    name: { before: user.name, after: parsed.data.name },
    phone: { before: user.phone, after: parsed.data.phone },
  });

  revalidateUserAdminPaths(user.id);
  return { ok: true as const };
}

const internalNotesSchema = z.object({
  userId: z.string().uuid(),
  adminInternalNotes: z.string().max(20_000, "Notes too long").default(""),
});

export type UpdateInternalNotesState = { ok?: true; error?: string; fieldErrors?: Record<string, string[]> };

export async function updateAdminInternalNotesAction(
  _prev: UpdateInternalNotesState,
  formData: FormData,
): Promise<UpdateInternalNotesState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const parsed = internalNotesSchema.safeParse({
    userId: formData.get("userId"),
    adminInternalNotes: String(formData.get("adminInternalNotes") ?? ""),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const database = requireDb();
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);

  if (!user || user.deletedAt) return { error: "User not found." };

  const before = user.adminInternalNotes ?? "";
  const after = parsed.data.adminInternalNotes;
  const now = new Date();

  await database
    .update(users)
    .set({
      adminInternalNotes: after,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  await insertUserAudit(adminId, "user.internal_notes_updated", user.id, {
    email: user.email,
    lengthBefore: before.length,
    lengthAfter: after.length,
    previewAfter: after.slice(0, 160),
  });

  revalidateUserAdminPaths(user.id);
  return { ok: true as const };
}

export type AdminUserActionFormState = { ok: true } | { error: string } | null;

export async function approveUserFormAction(
  _prev: AdminUserActionFormState,
  formData: FormData,
): Promise<AdminUserActionFormState> {
  return approveUserAction(formData);
}

export async function rejectUserFormAction(
  _prev: AdminUserActionFormState,
  formData: FormData,
): Promise<AdminUserActionFormState> {
  return rejectUserAction(formData);
}

export async function pauseUserFormAction(
  _prev: AdminUserActionFormState,
  formData: FormData,
): Promise<AdminUserActionFormState> {
  return pauseUserAction(formData);
}

export async function archiveUserFormAction(
  _prev: AdminUserActionFormState,
  formData: FormData,
): Promise<AdminUserActionFormState> {
  return archiveUserAction(formData);
}
