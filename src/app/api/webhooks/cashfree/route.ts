import { requireDb } from "@/server/db/require-db";
import { sendBillingPaymentSuccessEmailAfterWebhook } from "@/server/notifications/send-billing-payment-success-email";
import type { BillingPaymentSuccessEmailPayload } from "@/server/payments/cashfree/parse-webhook";
import { parseCashfreeWebhookForFulfillment } from "@/server/payments/cashfree/parse-webhook";
import { verifyCashfreeWebhookSignature } from "@/server/payments/cashfree/verify-webhook";
import { fulfillStrategyPaymentFromWebhook } from "@/server/payments/fulfill-strategy-payment";
import { releaseRevenueBlock } from "@/server/revenue/revenue-due-gate";

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

  let releaseUserId: string | undefined;
  let billingReceipt: BillingPaymentSuccessEmailPayload | undefined;

  try {
    await db.transaction(async (tx) => {
      const r = await fulfillStrategyPaymentFromWebhook(tx, fulfillment);
      releaseUserId = r.releaseRevenueBlockForUserId;
      billingReceipt = r.billingPaymentSuccess;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cashfree webhook] fulfillment error:", msg);
    return Response.json({ error: "fulfillment_failed" }, { status: 500 });
  }

  if (releaseUserId) {
    try {
      await releaseRevenueBlock(releaseUserId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cashfree webhook] releaseRevenueBlock error:", msg);
    }
  }

  if (billingReceipt) {
    try {
      await sendBillingPaymentSuccessEmailAfterWebhook(billingReceipt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cashfree webhook] payment success email error:", msg);
    }
  }

  return Response.json({ ok: true });
}
