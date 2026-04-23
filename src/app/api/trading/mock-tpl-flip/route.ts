import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import { strategies, userStrategyRuns, userStrategySubscriptions } from "@/server/db/schema";
import { tradingLog } from "@/server/trading/trading-log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  runId: z.string().uuid().optional(),
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

  const { runId: requestedRunId, direction } = parsed.data;

  const runSelect = {
    runId: userStrategyRuns.id,
    runSettingsJson: userStrategyRuns.runSettingsJson,
  };
  const isTplSlug = sql`lower(${strategies.slug}) like ${"%trend-profit-lock-scalping%"}`;
  const [run] =
    session.role === "admin"
      ? requestedRunId
        ? await db
            .select(runSelect)
            .from(userStrategyRuns)
            .innerJoin(
              userStrategySubscriptions,
              eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
            )
            .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
            .where(
              and(
                eq(userStrategyRuns.id, requestedRunId),
                eq(userStrategyRuns.status, "active"),
                eq(userStrategySubscriptions.status, "active"),
                isNull(userStrategySubscriptions.deletedAt),
                isNull(strategies.deletedAt),
                isTplSlug,
              ),
            )
            .limit(1)
        : await db
            .select(runSelect)
            .from(userStrategyRuns)
            .innerJoin(
              userStrategySubscriptions,
              eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
            )
            .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
            .where(
              and(
                eq(userStrategyRuns.status, "active"),
                eq(userStrategySubscriptions.status, "active"),
                isNull(userStrategySubscriptions.deletedAt),
                isNull(strategies.deletedAt),
                isTplSlug,
              ),
            )
            .orderBy(desc(userStrategyRuns.updatedAt))
            .limit(1)
      : requestedRunId
        ? await db
            .select(runSelect)
            .from(userStrategyRuns)
            .innerJoin(
              userStrategySubscriptions,
              eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
            )
            .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
            .where(
              and(
                eq(userStrategyRuns.id, requestedRunId),
                eq(userStrategySubscriptions.userId, session.userId),
                eq(userStrategyRuns.status, "active"),
                eq(userStrategySubscriptions.status, "active"),
                isNull(userStrategySubscriptions.deletedAt),
                isNull(strategies.deletedAt),
                isTplSlug,
              ),
            )
            .limit(1)
        : await db
            .select(runSelect)
            .from(userStrategyRuns)
            .innerJoin(
              userStrategySubscriptions,
              eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
            )
            .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
            .where(
              and(
                eq(userStrategySubscriptions.userId, session.userId),
                eq(userStrategyRuns.status, "active"),
                eq(userStrategySubscriptions.status, "active"),
                isNull(userStrategySubscriptions.deletedAt),
                isNull(strategies.deletedAt),
                isTplSlug,
              ),
            )
            .orderBy(desc(userStrategyRuns.updatedAt))
            .limit(1);

  if (!run) {
    return Response.json(
      { error: "no_active_tpl_run_found_for_mock_flip" },
      { status: 404 },
    );
  }
  tradingLog("info", "tpl_mock_api_received", {
    requestedRunId: requestedRunId ?? null,
    resolvedRunId: run.runId,
    direction,
    role: session.role,
    userId: session.userId,
  });

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

  return Response.json({ ok: true, runId: run.runId, direction });
}
