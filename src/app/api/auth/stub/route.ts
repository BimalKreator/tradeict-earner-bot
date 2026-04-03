import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * Phase 1 only: sets a non-production session cookie so middleware can be exercised.
 * Disable in real production unless AUTH_PHASE1_ALLOW_STUB=true (emergency dev access).
 */
export async function POST(request: Request) {
  const allowStub =
    process.env.NODE_ENV !== "production" ||
    process.env.AUTH_PHASE1_ALLOW_STUB === "true";

  if (!allowStub) {
    return NextResponse.json({ error: "Stub auth disabled" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const nextRaw = formData?.get("next");
  const next =
    typeof nextRaw === "string" && nextRaw.startsWith("/") ? nextRaw : "/user/dashboard";

  const url = new URL(next, request.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE_NAME, "phase1-stub", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
