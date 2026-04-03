import { NextResponse } from "next/server";

/**
 * Protect cron routes: set `CRON_SECRET` in the environment and send either
 * `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>` (for manual curl).
 * Vercel Cron can inject the same secret via Authorization (configure in project env).
 */
export function verifyCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  const bearer =
    auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
  const q = new URL(request.url).searchParams.get("secret");
  return bearer === secret || q === secret;
}

export function cronUnauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
