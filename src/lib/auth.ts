import type { NextRequest } from "next/server";

/** HttpOnly cookie storing signed JWT (user sessions) or legacy `phase1-stub` in dev. */
export const SESSION_COOKIE_NAME = "tradeict_session";

export function readSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/** True if any session cookie is present (does not verify signature — use in non-security checks only). */
export function isAuthenticatedRequest(request: NextRequest): boolean {
  return Boolean(readSessionToken(request));
}
