import { eq } from "drizzle-orm";

import { users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { sendTransactionalEmail } from "@/server/email/send-email";
import { billingPaymentSuccessEmail } from "@/server/notifications/email-templates";
import type { BillingPaymentSuccessEmailPayload } from "@/server/payments/cashfree/parse-webhook";

/**
 * Fire-and-forget after Cashfree webhook tx commits. Idempotent at payment layer:
 * duplicate SUCCESS webhooks short-circuit before this runs.
 */
export async function sendBillingPaymentSuccessEmailAfterWebhook(
  payload: BillingPaymentSuccessEmailPayload,
): Promise<void> {
  let db;
  try {
    db = requireDb();
  } catch {
    return;
  }

  const [u] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!u?.email) return;

  const body =
    payload.kind === "strategy_subscription"
      ? billingPaymentSuccessEmail({
          kind: "strategy_subscription",
          name: u.name,
          strategyName: payload.strategyName,
          amountInr: payload.amountInr,
          accessValidUntil: payload.accessValidUntil,
          isRenewal: payload.isRenewal,
        })
      : billingPaymentSuccessEmail({
          kind: "revenue_share",
          name: u.name,
          strategyName: payload.strategyName,
          amountInr: payload.amountInr,
          weekStartIst: payload.weekStartIst,
          weekEndIst: payload.weekEndIst,
        });

  await sendTransactionalEmail({
    to: u.email,
    subject: body.subject,
    text: body.text,
    html: body.html,
    templateKey: "billing.payment_success",
    userId: payload.userId,
    notificationMetadata: {
      payment_id: payload.paymentId,
      product: payload.kind,
    },
  });
}
