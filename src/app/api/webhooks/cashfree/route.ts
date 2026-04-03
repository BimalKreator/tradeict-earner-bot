import { requireDb } from "@/server/db/require-db";
import { parseCashfreeWebhookForFulfillment } from "@/server/payments/cashfree/parse-webhook";
import { verifyCashfreeWebhookSignature } from "@/server/payments/cashfree/verify-webhook";
import { fulfillStrategyPaymentFromWebhook } from "@/server/payments/fulfill-strategy-payment";

export const dynamic = "force-dynamic";

/**
 * Cashfree server-to-server webhooks. Raw body required for HMAC verification.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const secret =
    process.env.CASHFREE_SECRET_KEY?.trim() ??
    process.env.CASHFREE_CLIENT_SECRET?.trim();

  if (!secret) {
    console.error("[cashfree webhook] CASHFREE_SECRET_KEY not configured");
    return Response.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const signatureOk = verifyCashfreeWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("x-webhook-signature"),
    timestampHeader: request.headers.get("x-webhook-timestamp"),
    secretKey: secret,
  });

  if (!signatureOk) {
    return new Response("invalid signature", { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const fulfillment = parseCashfreeWebhookForFulfillment(parsed);
  if (!fulfillment) {
    return Response.json({ ok: true, note: "no_order_id" });
  }

  const db = requireDb();

  try {
    await db.transaction(async (tx) => {
      await fulfillStrategyPaymentFromWebhook(tx, fulfillment);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cashfree webhook] fulfillment error:", msg);
    return Response.json({ error: "fulfillment_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
