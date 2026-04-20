import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { db } from "@/server/db";
import {
  getLatestUserLiveReconciledAt,
  getUserLiveOpenPositions,
} from "@/server/queries/live-positions-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session || session.role !== "user") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!db) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }

  const positions = await getUserLiveOpenPositions(session.userId);
  const reconciledAt = await getLatestUserLiveReconciledAt(session.userId);
  return Response.json({
    positions,
    updatedAt: new Date().toISOString(),
    reconciledAt,
  });
}
