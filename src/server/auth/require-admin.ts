import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { isPhase1StubToken, verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";

/**
 * Server Components under /admin/(panel): admin JWT + row in `admins`.
 *
 * **Never** skipped for `AUTH_PHASE1_BYPASS` (that flag only relaxes `/user/*`
 * in middleware so standard users cannot enter the admin UI with a user session).
 */
export async function requireAdminSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/admin/login");
  }

  if (isPhase1StubToken(token)) {
    redirect("/admin/login");
  }

  const session = await verifySessionToken(token);
  if (!session) {
    redirect("/admin/login");
  }

  if (session.role === "user") {
    redirect("/user/dashboard");
  }

  if (session.role !== "admin") {
    redirect("/admin/login");
  }

  const exists = await adminActiveRecordExists(session.userId);
  if (!exists) {
    redirect("/admin/login");
  }
}
