import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { isPhase1StubToken, verifySessionToken } from "@/lib/session";

/**
 * Server Components under /admin/(panel): ensures an admin JWT is present.
 * Skipped when AUTH_PHASE1_BYPASS matches middleware behavior (local dev).
 */
export async function requireAdminSession(): Promise<void> {
  if (process.env.AUTH_PHASE1_BYPASS === "true") {
    return;
  }

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/admin/login");
  }

  if (isPhase1StubToken(token)) {
    const allowStub =
      process.env.NODE_ENV !== "production" ||
      process.env.AUTH_PHASE1_ALLOW_STUB === "true";
    if (allowStub) {
      return;
    }
    redirect("/admin/login");
  }

  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    redirect("/admin/login");
  }
}
