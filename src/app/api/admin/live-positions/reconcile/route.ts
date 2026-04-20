import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { runLivePositionReconciliationOnce } from "@/server/trading/position-reconciliation";

export const dynamic = "force-dynamic";

export async function POST() {
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

  const out = await runLivePositionReconciliationOnce();
  return Response.json(out);
}
