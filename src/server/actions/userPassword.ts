"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUserId } from "@/server/auth/require-user";
import { logAuditEvent } from "@/server/audit/audit-logger";
import { users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(128),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ChangePasswordState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function changePasswordFromProfileAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { error: "Please sign in again." };
  }

  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  let database;
  try {
    database = requireDb();
  } catch {
    return { error: "Service temporarily unavailable." };
  }

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.deletedAt || !user.passwordHash) {
    return { error: "Password change is not available for this account." };
  }

  const match = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash,
  );
  if (!match) {
    return { error: "Current password is incorrect." };
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  const now = new Date();

  await database
    .update(users)
    .set({ passwordHash: newHash, updatedAt: now })
    .where(eq(users.id, userId));

  await logAuditEvent({
    actorType: "user",
    actorUserId: userId,
    action: "user.password_changed",
    entityType: "user",
    entityId: userId,
    metadata: { source: "profile" },
  });

  revalidatePath("/user/profile");
  return { ok: true };
}
