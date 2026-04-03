import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { fetchUserFundsLiveFromDelta } from "@/server/queries/user-funds-exchange";

export const dynamic = "force-dynamic";

/**
 * Pollable Delta wallet snapshot (balances + latest movements). No secrets in response.
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

  const payload = await fetchUserFundsLiveFromDelta(session.userId);
  return Response.json(payload);
}
