import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { userStrategyRuns } from "@/server/db/schema";

const REASON_MAX = 512;

/**
 * Auto-pause after Delta reports insufficient margin/balance so the worker does not
 * hammer the API with doomed submissions.
 */
export async function pauseRunForInsufficientFunds(
  runId: string,
  detail: string,
): Promise<void> {
  if (!db) return;
  const now = new Date();
  const lastStateReason = `insufficient_funds:${detail.slice(0, REASON_MAX)}`;
  await db
    .update(userStrategyRuns)
    .set({
      status: "paused_insufficient_funds",
      pausedAt: now,
      lastStateReason,
      updatedAt: now,
    })
    .where(eq(userStrategyRuns.id, runId));
}
