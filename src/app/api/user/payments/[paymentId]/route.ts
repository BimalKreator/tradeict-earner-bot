import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { db } from "@/server/db";
import { payments } from "@/server/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ paymentId: string }> };

/**
 * Poll payment status after Cashfree return (server truth only).
 */
export async function GET(_request: Request, ctx: Ctx) {
  const { paymentId } = await ctx.params;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(paymentId)) {
    return Response.json({ error: "invalid_payment_id" }, { status: 400 });
  }

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

  const [row] = await db
    .select({
      status: payments.status,
      userId: payments.userId,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!row || row.userId !== session.userId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({ status: row.status });
}
