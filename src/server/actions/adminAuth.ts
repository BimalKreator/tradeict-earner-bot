"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { getJwtSecretBytes, SESSION_COOKIE_MAX_AGE, signAdminSession } from "@/lib/session";
import { admins } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export type AdminLoginState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function databaseErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: string }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return String(e);
}

export async function adminLoginAction(
  _prev: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
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
  } catch (e: unknown) {
    const msg = databaseErrorMessage(e);
    if (msg.includes("DATABASE_URL")) {
      return {
        error:
          "Database not configured: DATABASE_URL is not set (cannot load admin accounts).",
      };
    }
    return { error: `Database not available: ${msg}` };
  }

  const email = parsed.data.email.toLowerCase();

  let admin;
  try {
    const rows = await database
      .select()
      .from(admins)
      .where(eq(admins.email, email))
      .limit(1);
    admin = rows[0];
  } catch (e: unknown) {
    return {
      error: `Database error while loading admin: ${databaseErrorMessage(e)}`,
    };
  }

  if (!admin) {
    return { error: "Admin not found." };
  }

  if (admin.deletedAt) {
    return { error: "Admin not found (account removed)." };
  }

  const ok = await bcrypt.compare(parsed.data.password, admin.passwordHash);
  if (!ok) {
    return { error: "Invalid credentials." };
  }

  const secret = getJwtSecretBytes();
  if (!secret && process.env.NODE_ENV === "production") {
    return {
      error:
        "Missing AUTH_SECRET: set AUTH_SECRET to at least 32 characters in production.",
    };
  }

  const token = await signAdminSession(admin.id);
  if (!token) {
    return {
      error:
        "Could not sign session: AUTH_SECRET missing or invalid (need 32+ characters in production).",
    };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  redirect("/admin/dashboard");
}
