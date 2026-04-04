"use server";

import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import type { ProfileChangesJson } from "@/lib/profile-change-fields";
import {
  PROFILE_CHANGE_FIELD_KEYS,
  type ProfileChangeFieldKey,
  PROFILE_FIELD_LABELS,
} from "@/lib/profile-change-fields";
import { logAdminAction } from "@/server/audit/audit-logger";
import { profileChangeRequests, users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import {
  profileChangeApprovedEmail,
  profileChangeRejectedEmail,
} from "@/server/email/templates";
import { sendTransactionalEmail } from "@/server/email/send-email";

async function requireAdminId(): Promise<string> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new Error("UNAUTHORIZED");
  }
  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    throw new Error("UNAUTHORIZED");
  }
  return session.userId;
}

const uuid = z.string().uuid();

function isProfileChangeFieldKey(k: string): k is ProfileChangeFieldKey {
  return (PROFILE_CHANGE_FIELD_KEYS as readonly string[]).includes(k);
}

function validateChangesPayload(raw: unknown): ProfileChangesJson {
  if (!raw || typeof raw !== "object") {
    throw new Error("INVALID_CHANGES");
  }
  const obj = raw as Record<string, unknown>;
  const out: ProfileChangesJson = {};
  for (const key of Object.keys(obj)) {
    if (!isProfileChangeFieldKey(key)) {
      throw new Error("INVALID_FIELD");
    }
    const v = obj[key];
    if (!v || typeof v !== "object") throw new Error("INVALID_ENTRY");
    const e = v as { old?: unknown; new?: unknown };
    const oldVal = e.old == null ? null : String(e.old);
    const newVal = e.new == null ? null : String(e.new);
    if (key === "email") {
      const parsed = z.string().trim().email().safeParse(newVal ?? "");
      if (!parsed.success) throw new Error("INVALID_EMAIL");
    }
    if (key === "name" && newVal != null && newVal.length < 2) {
      throw new Error("INVALID_NAME");
    }
    if (key === "phone" && newVal != null && newVal.length > 0) {
      const p = z
        .string()
        .min(10)
        .regex(/^[0-9+-]+$/)
        .safeParse(newVal);
      if (!p.success) throw new Error("INVALID_PHONE");
    }
    if (key === "whatsapp_number" && newVal != null && newVal !== "") {
      if (!/^[0-9+-]+$/.test(newVal)) throw new Error("INVALID_WHATSAPP");
    }
    out[key] = { old: oldVal, new: newVal };
  }
  if (Object.keys(out).length === 0) throw new Error("EMPTY_CHANGES");
  return out;
}

export type AdminProfileRequestActionState =
  | { ok: true }
  | { error: string }
  | null;

export async function approveProfileChangeRequestAction(
  _prev: AdminProfileRequestActionState,
  formData: FormData,
): Promise<AdminProfileRequestActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const parsedId = uuid.safeParse(formData.get("requestId"));
  if (!parsedId.success) return { error: "Invalid request." };

  const database = requireDb();
  const requestId = parsedId.data;
  const now = new Date();

  let mailPayload: {
    userId: string;
    notifyEmail: string;
    userName: string | null;
    summaryLines: string[];
  };

  try {
    mailPayload = await database.transaction(async (tx) => {
      const [req] = await tx
        .select()
        .from(profileChangeRequests)
        .where(
          and(
            eq(profileChangeRequests.id, requestId),
            eq(profileChangeRequests.status, "pending"),
          ),
        )
        .limit(1);

      if (!req) {
        throw new Error("NOT_PENDING");
      }

      let changes: ProfileChangesJson;
      try {
        changes = validateChangesPayload(req.changesJson);
      } catch {
        throw new Error("INVALID_PAYLOAD");
      }

      const [u] = await tx
        .select()
        .from(users)
        .where(eq(users.id, req.userId))
        .limit(1);

      if (!u || u.deletedAt) {
        throw new Error("NO_USER");
      }

      if (changes.email?.new) {
        const emailNorm = changes.email.new.toLowerCase();
        const [taken] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.email, emailNorm), ne(users.id, u.id)),
          )
          .limit(1);
        if (taken) {
          throw new Error("EMAIL_TAKEN");
        }
      }

      const set: {
        name?: string | null;
        address?: string | null;
        phone?: string | null;
        whatsappNumber?: string | null;
        email?: string;
        updatedAt: Date;
      } = { updatedAt: now };

      if (changes.name) set.name = changes.name.new;
      if (changes.address) set.address = changes.address.new;
      if (changes.phone) set.phone = changes.phone.new;
      if (changes.whatsapp_number) {
        set.whatsappNumber = changes.whatsapp_number.new;
      }
      if (changes.email) set.email = changes.email.new!.toLowerCase();

      await tx.update(users).set(set).where(eq(users.id, u.id));

      await tx
        .update(profileChangeRequests)
        .set({
          status: "approved",
          reviewedAt: now,
          reviewedByAdminId: adminId,
          reviewNote: null,
          updatedAt: now,
        })
        .where(eq(profileChangeRequests.id, req.id));

      await logAdminAction({
        actorAdminId: adminId,
        action: "profile_change_request.approved",
        entityType: "profile_change_request",
        entityId: req.id,
        extra: {
          target_user_id: u.id,
          changes: Object.keys(changes),
        },
        tx,
      });

      const summaryLines = Object.keys(changes).map((k) => {
        const key = k as ProfileChangeFieldKey;
        const label = PROFILE_FIELD_LABELS[key];
        const ch = changes[key]!;
        return `${label}: "${ch.old ?? "—"}" → "${ch.new ?? "—"}"`;
      });

      return {
        userId: u.id,
        notifyEmail: changes.email?.new
          ? changes.email.new.toLowerCase()
          : u.email,
        userName: u.name,
        summaryLines,
      };
    });
  } catch (e: unknown) {
    const code = e instanceof Error ? e.message : String(e);
    if (code === "NOT_PENDING") {
      return {
        error:
          "This request is no longer pending (it may have been processed already).",
      };
    }
    if (code === "EMAIL_TAKEN") {
      return {
        error:
          "That email is already used by another account. Approve blocked; reject or ask the user to resubmit.",
      };
    }
    if (code === "NO_USER") {
      return { error: "User account not found." };
    }
    if (
      code === "INVALID_PAYLOAD" ||
      code === "INVALID_CHANGES" ||
      code === "INVALID_FIELD" ||
      code === "INVALID_ENTRY" ||
      code === "INVALID_EMAIL" ||
      code === "INVALID_NAME" ||
      code === "INVALID_PHONE" ||
      code === "INVALID_WHATSAPP" ||
      code === "EMPTY_CHANGES"
    ) {
      return { error: "Invalid change payload; cannot approve." };
    }
    throw e;
  }

  const body = profileChangeApprovedEmail({
    name: mailPayload.userName,
    summaryLines: mailPayload.summaryLines,
  });
  await sendTransactionalEmail({
    to: mailPayload.notifyEmail,
    templateKey: "admin.profile_change_approved",
    subject: body.subject,
    text: body.text,
    html: body.html,
    userId: mailPayload.userId,
    notificationMetadata: {
      fields: mailPayload.summaryLines.length,
    },
  });

  revalidatePath("/admin/profile-requests");
  revalidatePath("/user/profile");
  return { ok: true };
}

export async function rejectProfileChangeRequestAction(
  _prev: AdminProfileRequestActionState,
  formData: FormData,
): Promise<AdminProfileRequestActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const parsedId = uuid.safeParse(formData.get("requestId"));
  if (!parsedId.success) return { error: "Invalid request." };

  const noteRaw = formData.get("note");
  const note =
    typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : null;

  const database = requireDb();
  const requestId = parsedId.data;
  const now = new Date();

  const [req] = await database
    .select()
    .from(profileChangeRequests)
    .where(
      and(
        eq(profileChangeRequests.id, requestId),
        eq(profileChangeRequests.status, "pending"),
      ),
    )
    .limit(1);

  if (!req) {
    return {
      error:
        "This request is no longer pending (it may have been processed already).",
    };
  }

  const [u] = await database
    .select()
    .from(users)
    .where(eq(users.id, req.userId))
    .limit(1);

  if (!u || u.deletedAt) {
    return { error: "User account not found." };
  }

  await database
    .update(profileChangeRequests)
    .set({
      status: "rejected",
      reviewedAt: now,
      reviewedByAdminId: adminId,
      reviewNote: note,
      updatedAt: now,
    })
    .where(eq(profileChangeRequests.id, req.id));

  await logAdminAction({
    actorAdminId: adminId,
    action: "profile_change_request.rejected",
    entityType: "profile_change_request",
    entityId: req.id,
    extra: { target_user_id: u.id, note },
  });

  const body = profileChangeRejectedEmail({ name: u.name, note });
  await sendTransactionalEmail({
    to: u.email,
    templateKey: "admin.profile_change_rejected",
    subject: body.subject,
    text: body.text,
    html: body.html,
    userId: u.id,
    notificationMetadata: { has_note: Boolean(note) },
  });

  revalidatePath("/admin/profile-requests");
  revalidatePath("/user/profile");
  return { ok: true };
}

export async function approveProfileChangeRequestFormAction(
  _prev: AdminProfileRequestActionState,
  formData: FormData,
): Promise<AdminProfileRequestActionState> {
  return approveProfileChangeRequestAction(_prev, formData);
}

export async function rejectProfileChangeRequestFormAction(
  _prev: AdminProfileRequestActionState,
  formData: FormData,
): Promise<AdminProfileRequestActionState> {
  return rejectProfileChangeRequestAction(_prev, formData);
}
