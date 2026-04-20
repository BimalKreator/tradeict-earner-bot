import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import { tradingExecutionJobs } from "@/server/db/schema";

export const dynamic = "force-dynamic";

type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead";

export async function GET(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "admin") {
    const ok = await adminActiveRecordExists(session.userId);
    if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  } else if (session.role !== "user") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!db) return Response.json({ error: "no_database" }, { status: 503 });

  const url = new URL(req.url);
  const requestId = url.searchParams.get("requestId")?.trim() ?? "";
  if (!requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 });
  }

  const rows = await db
    .select({
      status: tradingExecutionJobs.status,
      lastError: tradingExecutionJobs.lastError,
    })
    .from(tradingExecutionJobs)
    .where(
      and(
        sql`${tradingExecutionJobs.payload}->'signalMetadata'->>'manual_close_request_id' = ${requestId}`,
        eq(tradingExecutionJobs.jobKind, "execute_strategy_signal"),
      ),
    );

  if (rows.length === 0) {
    return Response.json({
      requestId,
      status: "not_found",
      message:
        "No worker jobs found for this request yet. It may be virtual immediate close or still propagating.",
      counts: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 },
      failureReason: null,
    });
  }

  const counts = rows.reduce(
    (acc, row) => {
      const st = row.status as JobStatus;
      acc.total += 1;
      if (st === "pending") acc.pending += 1;
      else if (st === "processing") acc.processing += 1;
      else if (st === "completed") acc.completed += 1;
      else if (st === "failed") acc.failed += 1;
      else if (st === "dead") acc.dead += 1;
      return acc;
    },
    { total: 0, pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 },
  );

  const hardFailure = rows.find((r) => r.status === "dead" || r.status === "failed");
  if (hardFailure) {
    return Response.json({
      requestId,
      status: "failed",
      message: "Manual close failed in worker.",
      counts,
      failureReason: hardFailure.lastError ?? "unknown_worker_error",
    });
  }

  if (counts.completed === counts.total) {
    return Response.json({
      requestId,
      status: "success",
      message: "Manual close worker jobs completed successfully.",
      counts,
      failureReason: null,
    });
  }

  return Response.json({
    requestId,
    status: "pending",
    message: "Manual close is still processing.",
    counts,
    failureReason: null,
  });
}
