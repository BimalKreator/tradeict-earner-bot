import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { isPhase1StubToken, verifySessionToken } from "@/lib/session";

/**
 * Resolves the signed-in end-user id from the session cookie.
 * Returns null when there is no valid user JWT (including stub tokens).
 */
export async function resolveUserIdFromSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token || isPhase1StubToken(token)) {
    return null;
  }
  const session = await verifySessionToken(token);
  if (!session || session.role !== "user") {
    return null;
  }
  return session.userId;
}

/**
 * User panel pages that require identity: redirect to login when session is missing
 * and bypass is off. When AUTH_PHASE1_BYPASS is on without a JWT, returns null
 * so the page can show a short explanation instead of looping redirects.
 */
export async function requireUserIdForPage(
  nextPath = "/user/profile",
): Promise<string | null> {
  const userId = await resolveUserIdFromSession();
  if (userId) return userId;

  if (process.env.AUTH_PHASE1_BYPASS === "true") {
    return null;
  }

  const url = `/login?next=${encodeURIComponent(nextPath)}`;
  redirect(url);
}

/** Server actions: must have a real user session. */
export async function requireUserId(): Promise<string> {
  const userId = await resolveUserIdFromSession();
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }
  return userId;
}
