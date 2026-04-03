"use server";

import bcrypt from "bcryptjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  MAX_OTP_SENDS_PER_15M,
  MAX_OTP_VERIFY_ATTEMPTS,
  MAX_PASSWORD_FAILS_PER_15M,
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SEC,
  RESET_CHALLENGE_COOKIE,
} from "@/lib/constants-auth";
import {
  signPasswordResetChallengeJwt,
  verifyPasswordResetChallengeJwt,
} from "@/lib/login-challenge";
import { generateOtpDigits, hashOtp, verifyOtpHash } from "@/lib/otp";
import { consumeRateBucket } from "@/lib/rate-limit-db";
import { loginOtps, users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { forgotPasswordOtpEmail } from "@/server/email/templates";
import { sendTransactionalEmail } from "@/server/email/send-email";

const emailSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
});

export type ForgotPasswordState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
}

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
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

  const email = parsed.data.email.toLowerCase();
  const rl = await consumeRateBucket(
    `forgot:${email}`,
    MAX_PASSWORD_FAILS_PER_15M,
  );
  if (!rl.ok) {
    return {
      error: `Too many requests. Try again in ${rl.retryAfterSec} seconds.`,
    };
  }

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user && !user.deletedAt && user.passwordHash) {
    const otpRl = await consumeRateBucket(
      `otp_send:${email}`,
      MAX_OTP_SENDS_PER_15M,
    );
    if (!otpRl.ok) {
      return {
        error: `Too many emails sent. Try again in ${otpRl.retryAfterSec} seconds.`,
      };
    }

    await database
      .update(loginOtps)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(loginOtps.userId, user.id),
          eq(loginOtps.purpose, "password_reset"),
          isNull(loginOtps.consumedAt),
        ),
      );

    const code = generateOtpDigits();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await database.insert(loginOtps).values({
      email,
      userId: user.id,
      codeHash,
      purpose: "password_reset",
      expiresAt,
      ipAddress: (await clientIp()) ?? undefined,
    });

    const body = forgotPasswordOtpEmail({ code });
    await sendTransactionalEmail({
      to: email,
      templateKey: "forgot_password_otp",
      subject: body.subject,
      text: body.text,
      html: body.html,
    });

    const challenge = await signPasswordResetChallengeJwt(user.id);
    if (!challenge) {
      return {
        error:
          "Could not start reset session. Ensure AUTH_SECRET is set (32+ characters).",
      };
    }
    const jar = await cookies();
    jar.set(RESET_CHALLENGE_COOKIE, challenge, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 900,
    });
    redirect("/reset-password");
  }

  redirect("/forgot-password?sent=1");
}

const resetSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code"),
    password: z.string().min(8, "At least 8 characters").max(128),
    confirmPassword: z.string().min(1, "Confirm password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function resetPasswordWithOtpAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetSchema.safeParse({
    code: formData.get("code"),
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

  const jar = await cookies();
  const challengeRaw = jar.get(RESET_CHALLENGE_COOKIE)?.value;
  const challenge = challengeRaw
    ? await verifyPasswordResetChallengeJwt(challengeRaw)
    : null;
  if (!challenge) {
    return {
      error: "Reset session expired. Start again from forgot password.",
    };
  }

  let database;
  try {
    database = requireDb();
  } catch {
    return { error: "Service temporarily unavailable." };
  }

  const [row] = await database
    .select()
    .from(loginOtps)
    .where(
      and(
        eq(loginOtps.userId, challenge.userId),
        eq(loginOtps.purpose, "password_reset"),
        isNull(loginOtps.consumedAt),
      ),
    )
    .orderBy(desc(loginOtps.createdAt))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    return { error: "Invalid or expired code. Request a new one." };
  }

  if (row.attemptCount >= MAX_OTP_VERIFY_ATTEMPTS) {
    return { error: "Too many attempts. Request a new reset link." };
  }

  const ok = await verifyOtpHash(parsed.data.code, row.codeHash);
  if (!ok) {
    await database
      .update(loginOtps)
      .set({ attemptCount: row.attemptCount + 1 })
      .where(eq(loginOtps.id, row.id));
    return { error: "Invalid code." };
  }

  const hash = await bcrypt.hash(parsed.data.password, 12);
  await database
    .update(users)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(users.id, challenge.userId));

  await database
    .update(loginOtps)
    .set({ consumedAt: new Date() })
    .where(eq(loginOtps.id, row.id));

  jar.delete(RESET_CHALLENGE_COOKIE);
  jar.delete(SESSION_COOKIE_NAME);

  redirect("/login?reset=1");
}

export type ResendResetOtpState = { error?: string; ok?: boolean };

export async function resendPasswordResetOtpAction(
  _prev: ResendResetOtpState,
  _formData: FormData,
): Promise<ResendResetOtpState> {
  const jar = await cookies();
  const challengeRaw = jar.get(RESET_CHALLENGE_COOKIE)?.value;
  const challenge = challengeRaw
    ? await verifyPasswordResetChallengeJwt(challengeRaw)
    : null;
  if (!challenge) {
    return { error: "Session expired. Start from forgot password." };
  }

  let database;
  try {
    database = requireDb();
  } catch {
    return { error: "Service unavailable." };
  }

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, challenge.userId))
    .limit(1);
  if (!user) return { error: "User not found." };

  const [last] = await database
    .select()
    .from(loginOtps)
    .where(
      and(
        eq(loginOtps.userId, user.id),
        eq(loginOtps.purpose, "password_reset"),
      ),
    )
    .orderBy(desc(loginOtps.createdAt))
    .limit(1);

  if (last) {
    const delta = (Date.now() - last.createdAt.getTime()) / 1000;
    if (delta < OTP_RESEND_COOLDOWN_SEC) {
      return {
        error: `Wait ${Math.ceil(OTP_RESEND_COOLDOWN_SEC - delta)}s before resending.`,
      };
    }
  }

  const otpRl = await consumeRateBucket(
    `otp_send:${user.email}`,
    MAX_OTP_SENDS_PER_15M,
  );
  if (!otpRl.ok) {
    return { error: `Too many emails. Try again in ${otpRl.retryAfterSec}s.` };
  }

  await database
    .update(loginOtps)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(loginOtps.userId, user.id),
        eq(loginOtps.purpose, "password_reset"),
        isNull(loginOtps.consumedAt),
      ),
    );

  const code = generateOtpDigits();
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  await database.insert(loginOtps).values({
    email: user.email,
    userId: user.id,
    codeHash,
    purpose: "password_reset",
    expiresAt,
    ipAddress: (await clientIp()) ?? undefined,
  });

  const body = forgotPasswordOtpEmail({ code });
  await sendTransactionalEmail({
    to: user.email,
    templateKey: "forgot_password_otp",
    subject: body.subject,
    text: body.text,
    html: body.html,
  });

  return { ok: true };
}
