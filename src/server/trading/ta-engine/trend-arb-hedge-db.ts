import { and, count, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db";
import { trendArbHedgeState } from "@/server/db/schema";

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
    .values({ runId, stepIndex })
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
