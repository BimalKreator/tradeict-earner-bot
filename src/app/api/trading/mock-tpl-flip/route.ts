import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import { userStrategyRuns, userStrategySubscriptions } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  runId: z.string().uuid(),
  direction: z.enum(["UP", "DOWN"]),
});

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.role === "admin") {
    const ok = await adminActiveRecordExists(session.userId);
    if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  } else if (session.role !== "user") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!db) return Response.json({ error: "no_database" }, { status: 503 });

  const bodyRaw = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload. Expected { runId, direction: 'UP' | 'DOWN' }." },
      { status: 400 },
    );
  }

  const { runId, direction } = parsed.data;

  const [run] =
    session.role === "admin"
      ? await db
          .select({
            runId: userStrategyRuns.id,
            runSettingsJson: userStrategyRuns.runSettingsJson,
          })
          .from(userStrategyRuns)
          .where(eq(userStrategyRuns.id, runId))
          .limit(1)
      : await db
          .select({
            runId: userStrategyRuns.id,
            runSettingsJson: userStrategyRuns.runSettingsJson,
          })
          .from(userStrategyRuns)
          .innerJoin(
            userStrategySubscriptions,
            eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
          )
          .where(
            and(
              eq(userStrategyRuns.id, runId),
              eq(userStrategySubscriptions.userId, session.userId),
            ),
          )
          .limit(1);

  if (!run) {
    return Response.json({ error: "run_not_found_or_forbidden" }, { status: 404 });
  }

  const parsedSettings = parseUserStrategyRunSettingsJson(run.runSettingsJson);
  const nextRunSettings = {
    ...parsedSettings,
    trendProfitLockRuntime: {
      ...(parsedSettings.trendProfitLockRuntime ?? {}),
      mockNextFlipDirection: direction,
    },
  };

  await db
    .update(userStrategyRuns)
    .set({
      runSettingsJson: nextRunSettings,
      updatedAt: new Date(),
    })
    .where(eq(userStrategyRuns.id, run.runId));

  return Response.json({ ok: true, runId, direction });
}
