import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { db } from "@/server/db";
import { userStrategyRuns, userStrategySubscriptions } from "@/server/db/schema";
import { humanizeTplExitReason } from "@/server/trading/tpl-trade-exit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session || session.role !== "user") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId")?.trim() ?? "";
  if (!runId) {
    return Response.json(
      { error: "runId required", reason: "unknown", reasonLabel: "Position closed" },
      { status: 400 },
    );
  }
  if (!db) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }

  const [row] = await db
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
      and(eq(userStrategyRuns.id, runId), eq(userStrategySubscriptions.userId, session.userId)),
    )
    .limit(1);

  if (!row) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = parseUserStrategyRunSettingsJson(row.runSettingsJson);
  const hint = parsed.lastTplTradeExitUi;
  const reason =
    hint && typeof hint.reason === "string" && hint.reason.length > 0 ? hint.reason : "unknown";
  const reasonLabel = humanizeTplExitReason(reason);
  return Response.json({
    runId: row.runId,
    reason,
    reasonLabel,
    at: hint?.at ?? null,
    leg: hint?.leg ?? null,
  });
}
