import { eq } from "drizzle-orm";

import { requireAdminId } from "@/server/auth/require-admin-id";
import { admins } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

/** Throws `Error("FORBIDDEN")` when the signed-in admin is not a super_admin. */
export async function requireSuperAdminId(): Promise<string> {
  const id = await requireAdminId();
  const database = requireDb();
  const [row] = await database
    .select({ role: admins.role })
    .from(admins)
    .where(eq(admins.id, id))
    .limit(1);
  if (!row || row.role !== "super_admin") {
    throw new Error("FORBIDDEN");
  }
  return id;
}
