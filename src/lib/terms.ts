import { desc, lte } from "drizzle-orm";

import { db } from "@/server/db";
import { termsVersions } from "@/server/db/schema";

/** Latest terms row that is already in effect (`effective_from <= now`). */
export async function getCurrentTermsVersion() {
  if (!db) return null;
  const now = new Date();
  const rows = await db
    .select()
    .from(termsVersions)
    .where(lte(termsVersions.effectiveFrom, now))
    .orderBy(desc(termsVersions.effectiveFrom), desc(termsVersions.version))
    .limit(1);
  return rows[0] ?? null;
}
