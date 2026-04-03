"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  PROFILE_REQUEST_SUBMITTED_HI,
  type ProfileChangesJson,
} from "@/lib/profile-change-fields";
import { requireUserId } from "@/server/auth/require-user";
import { profileChangeRequests, users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { userHasPendingProfileRequest } from "@/server/queries/profile-change-requests";

const fieldSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  address: z.string().trim().max(500),
  phone: z
    .string()
    .trim()
    .min(10, "Enter a valid mobile number")
    .max(20)
    .regex(/^[0-9+\s-]+$/, "Mobile should contain digits only"),
  whatsapp_number: z
    .string()
    .trim()
    .max(20)
    .refine(
      (s) => s === "" || /^[0-9+\s-]+$/.test(s),
      "WhatsApp should contain digits only",
    ),
  email: z.string().trim().email("Enter a valid email"),
});

export type SubmitProfileChangeState = {
  ok?: boolean;
  error?: string;
  messageHi?: string;
  fieldErrors?: Record<string, string[]>;
};

function normalizePhone(s: string) {
  return s.replace(/\s/g, "");
}

function normalizeWhatsapp(s: string) {
  const t = s.trim();
  if (t === "") return null;
  return t.replace(/\s/g, "");
}

export async function submitProfileChangeRequestAction(
  _prev: SubmitProfileChangeState,
  formData: FormData,
): Promise<SubmitProfileChangeState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { error: "Please sign in again." };
  }

  const parsed = fieldSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    whatsapp_number: formData.get("whatsapp_number"),
    email: formData.get("email"),
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

  if (await userHasPendingProfileRequest(userId)) {
    return {
      error:
        "A pending profile update is already waiting for admin review. Please wait until it is approved or rejected before submitting another request.",
    };
  }

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.deletedAt) {
    return { error: "Account not found." };
  }

  const newName = parsed.data.name;
  const newAddress =
    parsed.data.address.trim() === "" ? null : parsed.data.address.trim();
  const newPhone = normalizePhone(parsed.data.phone);
  const newWhatsapp = normalizeWhatsapp(parsed.data.whatsapp_number);
  const newEmail = parsed.data.email.toLowerCase();

  const oldName = user.name ?? null;
  const oldAddress = user.address ?? null;
  const oldPhone = user.phone ?? null;
  const oldWhatsapp = user.whatsappNumber ?? null;
  const oldEmail = user.email.toLowerCase();

  const changes: ProfileChangesJson = {};

  if (newName !== (oldName ?? "")) {
    changes.name = { old: oldName, new: newName };
  }
  if (newAddress !== oldAddress) {
    changes.address = { old: oldAddress, new: newAddress };
  }
  if (newPhone !== (oldPhone ?? "")) {
    changes.phone = { old: oldPhone, new: newPhone };
  }
  if (newWhatsapp !== (oldWhatsapp ?? "")) {
    changes.whatsapp_number = {
      old: oldWhatsapp,
      new: newWhatsapp,
    };
  }
  if (newEmail !== oldEmail) {
    changes.email = { old: oldEmail, new: newEmail };
  }

  if (Object.keys(changes).length === 0) {
    return { error: "No changes to submit." };
  }

  if (changes.email) {
    const [taken] = await database
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.email, changes.email.new!), ne(users.id, userId)),
      )
      .limit(1);
    if (taken) {
      return {
        error:
          "That email address is already used by another account. Choose a different email.",
      };
    }
  }

  await database.insert(profileChangeRequests).values({
    userId,
    changesJson: changes,
    status: "pending",
  });

  revalidatePath("/user/profile");
  return { ok: true, messageHi: PROFILE_REQUEST_SUBMITTED_HI };
}
