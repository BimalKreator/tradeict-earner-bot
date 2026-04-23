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

const isTplSlug = sql`lower(${strategies.slug}) like ${"%trend-profit-lock-scalping%"}`;

function buildRunSettingsWithMockDirection(
  existingRunSettingsJson: unknown,
  direction: "UP" | "DOWN",
): Record<string, unknown> {
  const parsedSettings = parseUserStrategyRunSettingsJson(existingRunSettingsJson);
  return {
    ...parsedSettings,
    trendProfitLockRuntime: {
      ...(parsedSettings.trendProfitLockRuntime ?? {}),
      mockNextFlipDirection: direction,
    },
  } as Record<string, unknown>;
}

function activeTplRunsWhere(exclusiveUserId: string | undefined) {
  const base = and(
    eq(userStrategyRuns.status, "active"),
    eq(userStrategySubscriptions.status, "active"),
    isNull(userStrategySubscriptions.deletedAt),
    isNull(strategies.deletedAt),
    isTplSlug,
  );
  if (exclusiveUserId) {
    return and(eq(userStrategySubscriptions.userId, exclusiveUserId), base);
  }
  return base;
}

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

  if (requestedRunId) {
    const whereSingleRun =
      session.role === "user"
        ? and(
            eq(userStrategyRuns.id, requestedRunId),
            eq(userStrategySubscriptions.userId, session.userId),
            eq(userStrategyRuns.status, "active"),
            eq(userStrategySubscriptions.status, "active"),
            isNull(userStrategySubscriptions.deletedAt),
            isNull(strategies.deletedAt),
            isTplSlug,
          )
        : and(
            eq(userStrategyRuns.id, requestedRunId),
            eq(userStrategyRuns.status, "active"),
            eq(userStrategySubscriptions.status, "active"),
            isNull(userStrategySubscriptions.deletedAt),
            isNull(strategies.deletedAt),
            isTplSlug,
          );
    const [row] = await db
      .select(runSelect)
      .from(userStrategyRuns)
      .innerJoin(
        userStrategySubscriptions,
        eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
      )
      .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
      .where(whereSingleRun)
      .limit(1);

    if (!row) {
      return Response.json(
        { error: "no_active_tpl_run_found_for_mock_flip" },
        { status: 404 },
      );
    }

    const nextRunSettings = buildRunSettingsWithMockDirection(row.runSettingsJson, direction);
    await db
      .update(userStrategyRuns)
      .set({
        runSettingsJson: nextRunSettings,
        updatedAt: new Date(),
      })
      .where(eq(userStrategyRuns.id, row.runId));

    tradingLog("info", "tpl_mock_api_received", {
      requestedRunId,
      resolvedRunId: row.runId,
      updatedCount: 1,
      direction,
      role: session.role,
      userId: session.userId,
    });

    return Response.json({
      ok: true,
      runId: row.runId,
      runIds: [row.runId],
      updatedCount: 1,
      direction,
      message: "Mock signal set on 1 active run.",
    });
  }

  const runs = await db
    .select(runSelect)
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
    .where(
      activeTplRunsWhere(session.role === "user" ? session.userId : undefined),
    )
    .orderBy(desc(userStrategyRuns.updatedAt));

  if (runs.length === 0) {
    return Response.json(
      { error: "no_active_tpl_run_found_for_mock_flip" },
      { status: 404 },
    );
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const r of runs) {
      const nextRunSettings = buildRunSettingsWithMockDirection(r.runSettingsJson, direction);
      await tx
        .update(userStrategyRuns)
        .set({
          runSettingsJson: nextRunSettings,
          updatedAt: now,
        })
        .where(eq(userStrategyRuns.id, r.runId));
    }
  });

  const runIds = runs.map((r) => r.runId);
  const updatedCount = runIds.length;
  const message = `Mock signal broadcast to ${updatedCount} active run${updatedCount === 1 ? "" : "s"}.`;

  tradingLog("info", "tpl_mock_api_broadcast", {
    requestedRunId: null,
    runIds,
    updatedCount,
    direction,
    role: session.role,
    userId: session.userId,
  });

  return Response.json({
    ok: true,
    runId: runIds[0] ?? null,
    runIds,
    updatedCount,
    direction,
    message,
  });
}
