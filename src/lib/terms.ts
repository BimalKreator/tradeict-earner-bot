import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { termsAndConditions } from "@/server/db/schema";

export type PublishedTerms = {
  versionName: string;
  content: string;
  publishedAt: Date;
};

/** Single active published row (partial unique index guarantees at most one). */
export async function getPublishedTerms(): Promise<PublishedTerms | null> {
  if (!db) return null;
  const [row] = await db
    .select({
      versionName: termsAndConditions.versionName,
      content: termsAndConditions.content,
      publishedAt: termsAndConditions.publishedAt,
    })
    .from(termsAndConditions)
    .where(eq(termsAndConditions.status, "published"))
    .limit(1);

  if (!row?.publishedAt) return null;
  return {
    versionName: row.versionName,
    content: row.content,
    publishedAt: row.publishedAt,
  };
}
