import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import { getAdminLiveTradeMonitorRows } from "@/server/queries/active-positions-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const exists = await adminActiveRecordExists(session.userId);
  if (!exists) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!db) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }

  const rows = await getAdminLiveTradeMonitorRows();
  return Response.json({ rows, updatedAt: new Date().toISOString() });
}
