import { and, count, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db";
import { trendArbHedgeState, trendArbVirtualHedgeState } from "@/server/db/schema";

function isMissingVirtualHedgeTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("trend_arb_virtual_hedge_state") &&
    (message.includes("does not exist") || message.includes('relation "trend_arb_virtual_hedge_state"'))
  );
}

export async function countHedgeStepsForRun(runId: string): Promise<number> {
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(trendArbHedgeState)
    .where(eq(trendArbHedgeState.runId, runId));
  return Number(row?.n ?? 0);
}

export async function recordHedgeStep(runId: string, stepIndex: number): Promise<void> {
  if (!db) return;
  await db
    .insert(trendArbHedgeState)
    .values({ runId, stepIndex, createdAt: new Date() })
    .onConflictDoNothing();
}

export async function clearHedgeStepsForRun(runId: string): Promise<void> {
  if (!db) return;
  await db.delete(trendArbHedgeState).where(eq(trendArbHedgeState.runId, runId));
}

/** True if any of the step indices are already recorded (batch check). */
export async function filterUnhedgedSteps(
  runId: string,
  steps: number[],
): Promise<number[]> {
  if (!db || steps.length === 0) return steps;
  const uniq = [...new Set(steps)].filter((s) => s >= 1);
  if (uniq.length === 0) return [];
  const rows = await db
    .select({ step: trendArbHedgeState.stepIndex })
    .from(trendArbHedgeState)
    .where(
      and(
        eq(trendArbHedgeState.runId, runId),
        inArray(trendArbHedgeState.stepIndex, uniq),
      ),
    );
  const done = new Set(rows.map((r) => r.step));
  return uniq.filter((s) => !done.has(s));
}

export async function countVirtualHedgeStepsForRun(runId: string): Promise<number> {
  if (!db) return 0;
  try {
    const [row] = await db
      .select({ n: count() })
      .from(trendArbVirtualHedgeState)
      .where(eq(trendArbVirtualHedgeState.runId, runId));
    return Number(row?.n ?? 0);
  } catch (error) {
    if (isMissingVirtualHedgeTableError(error)) return 0;
    throw error;
  }
}

export async function recordVirtualHedgeStep(runId: string, stepIndex: number): Promise<void> {
  if (!db) return;
  try {
    await db
      .insert(trendArbVirtualHedgeState)
      .values({ runId, stepIndex, createdAt: new Date() })
      .onConflictDoNothing();
  } catch (error) {
    if (isMissingVirtualHedgeTableError(error)) return;
    throw error;
  }
}

export async function clearVirtualHedgeStepsForRun(runId: string): Promise<void> {
  if (!db) return;
  try {
    await db.delete(trendArbVirtualHedgeState).where(eq(trendArbVirtualHedgeState.runId, runId));
  } catch (error) {
    if (isMissingVirtualHedgeTableError(error)) return;
    throw error;
  }
}

/** Same as `filterUnhedgedSteps`, but keyed by virtual run ids. */
export async function filterUnhedgedVirtualSteps(
  runId: string,
  steps: number[],
): Promise<number[]> {
  if (!db || steps.length === 0) return steps;
  const uniq = [...new Set(steps)].filter((s) => s >= 1);
  if (uniq.length === 0) return [];
  try {
    const rows = await db
      .select({ step: trendArbVirtualHedgeState.stepIndex })
      .from(trendArbVirtualHedgeState)
      .where(
        and(
          eq(trendArbVirtualHedgeState.runId, runId),
          inArray(trendArbVirtualHedgeState.stepIndex, uniq),
        ),
      );
    const done = new Set(rows.map((r) => r.step));
    return uniq.filter((s) => !done.has(s));
  } catch (error) {
    if (isMissingVirtualHedgeTableError(error)) return uniq;
    throw error;
  }
}
