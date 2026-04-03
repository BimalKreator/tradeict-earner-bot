"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { registrationReceivedEmail } from "@/server/email/templates";
import { sendTransactionalEmail } from "@/server/email/send-email";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: unknown };
  if (e?.code === "23505") return true;
  if (e?.cause) return isUniqueViolation(e.cause);
  return false;
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
    phone: z
      .string()
      .trim()
      .min(10, "Enter a valid mobile number")
      .max(20)
      .regex(/^[0-9+\s-]+$/, "Mobile should contain digits only"),
    email: z.string().trim().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function registerUserAction(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    password: formData.get("password"),
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
    return { error: "Service temporarily unavailable. Please try again later." };
  }

  const email = parsed.data.email.toLowerCase();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  try {
    await database.insert(users).values({
      email,
      name: parsed.data.name,
      phone: parsed.data.phone.replace(/\s/g, ""),
      passwordHash,
    });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      return {
        error:
          "An account with this email already exists. Try signing in instead.",
      };
    }
    console.error("registerUserAction", e);
    return { error: "Could not create account. Please try again." };
  }

  try {
    const regBody = registrationReceivedEmail({ name: parsed.data.name });
    await sendTransactionalEmail({
      to: email,
      templateKey: "registration_received",
      subject: regBody.subject,
      text: regBody.text,
      html: regBody.html,
    });
  } catch (e) {
    console.error("registerUserAction: confirmation email failed", e);
  }

  return { ok: true };
}

