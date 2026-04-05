import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";

/** Admin JWT `userId` for server actions; subject must exist in `admins`. */
export async function requireAdminId(): Promise<string> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new Error("UNAUTHORIZED");
  }
  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    throw new Error("UNAUTHORIZED");
  }
  const exists = await adminActiveRecordExists(session.userId);
  if (!exists) {
    throw new Error("UNAUTHORIZED");
  }
  return session.userId;
}
