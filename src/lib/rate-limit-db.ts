import { eq } from "drizzle-orm";

import { authRateBuckets } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

import { RATE_WINDOW_MS } from "./constants-auth";

/**
 * Sliding window counter: increment usage; block when count would exceed `max` inside the window.
 * First hit in a window starts count at 1.
 */
export async function consumeRateBucket(
  key: string,
  max: number,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const db = requireDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(authRateBuckets)
    .where(eq(authRateBuckets.key, key))
    .limit(1);

  if (!existing || now.getTime() - existing.windowStartedAt.getTime() > RATE_WINDOW_MS) {
    if (!existing) {
      try {
        await db.insert(authRateBuckets).values({
          key,
          count: 1,
          windowStartedAt: now,
        });
      } catch {
        await db
          .update(authRateBuckets)
          .set({ count: 1, windowStartedAt: now })
          .where(eq(authRateBuckets.key, key));
      }
    } else {
      await db
        .update(authRateBuckets)
        .set({ count: 1, windowStartedAt: now })
        .where(eq(authRateBuckets.key, key));
    }
    return { ok: true };
  }

  if (existing.count >= max) {
    const elapsed = now.getTime() - existing.windowStartedAt.getTime();
    const retryAfterSec = Math.max(
      1,
      Math.ceil((RATE_WINDOW_MS - elapsed) / 1000),
    );
    return { ok: false, retryAfterSec };
  }

  await db
    .update(authRateBuckets)
    .set({ count: existing.count + 1 })
    .where(eq(authRateBuckets.key, key));

  return { ok: true };
}

export async function resetRateBucket(key: string): Promise<void> {
  const db = requireDb();
  await db.delete(authRateBuckets).where(eq(authRateBuckets.key, key));
}
