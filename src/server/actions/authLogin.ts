"use server";

import bcrypt from "bcryptjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  LOGIN_CHALLENGE_COOKIE,
  MAX_OTP_SENDS_PER_15M,
  MAX_OTP_VERIFY_ATTEMPTS,
  MAX_PASSWORD_FAILS_PER_15M,
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SEC,
} from "@/lib/constants-auth";
import { signLoginChallengeJwt, verifyLoginChallengeJwt } from "@/lib/login-challenge";
import { generateOtpDigits, hashOtp, verifyOtpHash } from "@/lib/otp";
import { consumeRateBucket, resetRateBucket } from "@/lib/rate-limit-db";
import { SESSION_COOKIE_MAX_AGE, signUserSession } from "@/lib/session";
import { loginOtpEmail } from "@/server/email/templates";
import { sendTransactionalEmail } from "@/server/email/send-email";
import { loginOtps, users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

const PENDING_HINDI =
  "Aapka account abhi review mein hai. Approval ke baad aapko email bheji jayegi.";

const loginPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type LoginPasswordState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
}

async function issueLoginOtpAndEmail(
  database: ReturnType<typeof requireDb>,
  userId: string,
  email: string,
): Promise<void> {
  await database
    .update(loginOtps)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(loginOtps.userId, userId),
        eq(loginOtps.purpose, "login"),
        isNull(loginOtps.consumedAt),
      ),
    );

  const code = generateOtpDigits();
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
  );

  await database.insert(loginOtps).values({
    email,
    userId,
    codeHash,
    purpose: "login",
    expiresAt,
    ipAddress: (await clientIp()) ?? undefined,
  });

  const body = loginOtpEmail({ code });
  await sendTransactionalEmail({
    to: email,
    templateKey: "login_otp",
    subject: body.subject,
    text: body.text,
    html: body.html,
  });
}

export async function submitLoginPasswordAction(
  _prev: LoginPasswordState,
  formData: FormData,
): Promise<LoginPasswordState> {
  const nextRaw = formData.get("next");
  const next =
    typeof nextRaw === "string" && nextRaw.startsWith("/")
      ? nextRaw
      : "/user/dashboard";

  const parsed = loginPasswordSchema.safeParse({
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
  } catch {
    return { error: "Service temporarily unavailable. Please try again later." };
  }

  const email = parsed.data.email.toLowerCase();

  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || user.deletedAt || !user.passwordHash) {
    const rl = await consumeRateBucket(
      `pwd:${email}`,
      MAX_PASSWORD_FAILS_PER_15M,
    );
    if (!rl.ok) {
      return {
        error: `Too many sign-in attempts. Try again in ${rl.retryAfterSec} seconds.`,
      };
    }
    return { error: "Invalid email or password." };
  }

  const passwordOk = await bcrypt.compare(
    parsed.data.password,
    user.passwordHash,
  );
  if (!passwordOk) {
    const rl = await consumeRateBucket(
      `pwd:${email}`,
      MAX_PASSWORD_FAILS_PER_15M,
    );
    if (!rl.ok) {
      return {
        error: `Too many sign-in attempts. Try again in ${rl.retryAfterSec} seconds.`,
      };
    }
    return { error: "Invalid email or password." };
  }

  await resetRateBucket(`pwd:${email}`);

  if (user.approvalStatus === "pending_approval") {
    return { error: PENDING_HINDI };
  }

  if (user.approvalStatus === "rejected") {
    return {
      error:
        "Your registration was not approved. Please contact support if you believe this is a mistake.",
    };
  }

  if (user.approvalStatus === "archived") {
    return {
      error: "This account has been archived. Contact support if you need help.",
    };
  }

  if (user.approvalStatus !== "approved" && user.approvalStatus !== "paused") {
    return { error: "Your account cannot sign in yet." };
  }

  const otpRl = await consumeRateBucket(
    `otp_send:${email}`,
    MAX_OTP_SENDS_PER_15M,
  );
  if (!otpRl.ok) {
    return {
      error: `Too many verification codes requested. Try again in ${otpRl.retryAfterSec} seconds.`,
    };
  }

  await issueLoginOtpAndEmail(database, user.id, email);

  const challenge = await signLoginChallengeJwt(user.id, email);
  if (!challenge) {
    return { error: "Could not start verification. Please try again." };
  }

  const jar = await cookies();
  jar.set(LOGIN_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });

  redirect(`/login/verify?next=${encodeURIComponent(next)}`);
}

const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export type VerifyOtpState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function verifyLoginOtpAction(
  _prev: VerifyOtpState,
  formData: FormData,
): Promise<VerifyOtpState> {
  const nextRaw = formData.get("next");
  const next =
    typeof nextRaw === "string" && nextRaw.startsWith("/")
      ? nextRaw
      : "/user/dashboard";

  const parsed = otpSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const jar = await cookies();
  const challengeRaw = jar.get(LOGIN_CHALLENGE_COOKIE)?.value;
  const challenge = challengeRaw
    ? await verifyLoginChallengeJwt(challengeRaw)
    : null;
  if (!challenge) {
    return {
      error: "Session expired. Please sign in again with your password.",
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
        eq(loginOtps.purpose, "login"),
        isNull(loginOtps.consumedAt),
      ),
    )
    .orderBy(desc(loginOtps.createdAt))
    .limit(1);

  if (!row) {
    return { error: "No active verification code. Request a new code." };
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { error: "This code has expired. Request a new code." };
  }

  if (row.attemptCount >= MAX_OTP_VERIFY_ATTEMPTS) {
    return {
      error: "Too many incorrect attempts. Request a new code from the login page.",
    };
  }

  const ok = await verifyOtpHash(parsed.data.code, row.codeHash);
  if (!ok) {
    await database
      .update(loginOtps)
      .set({ attemptCount: row.attemptCount + 1 })
      .where(eq(loginOtps.id, row.id));
    return { error: "Invalid code. Please try again." };
  }

  await database
    .update(loginOtps)
    .set({ consumedAt: new Date() })
    .where(eq(loginOtps.id, row.id));

  jar.delete(LOGIN_CHALLENGE_COOKIE);

  const token = await signUserSession(challenge.userId);
  if (!token) {
    return { error: "Could not start session. Please try again." };
  }

  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  redirect(next);
}

export type ResendOtpState = {
  error?: string;
  ok?: boolean;
  cooldownSec?: number;
};

export async function resendLoginOtpAction(
  _prev: ResendOtpState,
  _formData: FormData,
): Promise<ResendOtpState> {
  const jar = await cookies();
  const challengeRaw = jar.get(LOGIN_CHALLENGE_COOKIE)?.value;
  const challenge = challengeRaw
    ? await verifyLoginChallengeJwt(challengeRaw)
    : null;
  if (!challenge) {
    return { error: "Session expired. Start again from the login page." };
  }

  let database;
  try {
    database = requireDb();
  } catch {
    return { error: "Service temporarily unavailable." };
  }

  const [last] = await database
    .select()
    .from(loginOtps)
    .where(
      and(
        eq(loginOtps.userId, challenge.userId),
        eq(loginOtps.purpose, "login"),
      ),
    )
    .orderBy(desc(loginOtps.createdAt))
    .limit(1);

  if (last) {
    const delta = (Date.now() - last.createdAt.getTime()) / 1000;
    if (delta < OTP_RESEND_COOLDOWN_SEC) {
      const sec = Math.ceil(OTP_RESEND_COOLDOWN_SEC - delta);
      return {
        error: `Please wait ${sec} seconds before resending.`,
        cooldownSec: sec,
      };
    }
  }

  const otpRl = await consumeRateBucket(
    `otp_send:${challenge.email}`,
    MAX_OTP_SENDS_PER_15M,
  );
  if (!otpRl.ok) {
    return {
      error: `Too many codes sent. Try again in ${otpRl.retryAfterSec} seconds.`,
      cooldownSec: otpRl.retryAfterSec,
    };
  }

  await issueLoginOtpAndEmail(database, challenge.userId, challenge.email);
  return { ok: true };
}
