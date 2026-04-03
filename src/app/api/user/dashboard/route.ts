import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { db } from "@/server/db";
import { getUserDashboardData } from "@/server/queries/user-dashboard";

export const dynamic = "force-dynamic";

/**
 * JSON bundle for the user dashboard (polling / future realtime).
 */
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

  const data = await getUserDashboardData(session.userId);
  if (!data) {
    return Response.json({ error: "load_failed" }, { status: 503 });
  }

  return Response.json(data);
}
