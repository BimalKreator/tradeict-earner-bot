import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/server/db";
import { admins } from "@/server/db/schema";

/**
 * True when this id is a non-deleted row in `admins`.
 * When `DATABASE_URL` is unset (e.g. build), JWT-only behaviour is preserved.
 */
export async function adminActiveRecordExists(adminId: string): Promise<boolean> {
  if (!db) return true;
  const [row] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.id, adminId), isNull(admins.deletedAt)))
    .limit(1);
  return row != null;
}
