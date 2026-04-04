import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";
import {
  invoices,
  payments,
  strategies,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";
import type {
  PaymentWebhookResult,
  WebhookFulfillmentInput,
} from "@/server/payments/cashfree/parse-webhook";
import { applyRevenuePaymentToLedgerAmounts } from "@/server/payments/revenue-ledger-payment-math";

type DbClient = PostgresJsDatabase<typeof schema>;
type PaymentRow = InferSelectModel<typeof payments>;

function invoiceNumberForPayment(paymentId: string): string {
  const y = new Date().getUTCFullYear();
  const compact = paymentId.replace(/-/g, "").slice(0, 12).toUpperCase();
  return `TE-RS-${y}-${compact}`;
}

function money2(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

/**
 * Cashfree webhook fulfillment for `payments.revenue_share_ledger_id` rows.
 * Idempotent: relies on parent lock + `payments.status === "success"` short-circuit
 * so duplicate SUCCESS webhooks never double-apply ledger or insert invoices.
 */
export async function fulfillRevenueSharePaymentFromWebhook(
  tx: DbClient,
  lockedPayment: PaymentRow,
  input: WebhookFulfillmentInput,
): Promise<PaymentWebhookResult> {
  const { paymentStatus, externalPaymentId } = input;
  const ledgerId = lockedPayment.revenueShareLedgerId;
  if (!ledgerId) {
    return { handled: true, skippedReason: "missing_ledger_id" };
  }

  const now = new Date();

  if (paymentStatus === "FAILED") {
    await tx
      .update(payments)
      .set({
        status: "failed",
        externalPaymentId: externalPaymentId ?? lockedPayment.externalPaymentId,
        updatedAt: now,
        metadata: {
          ...(lockedPayment.metadata ?? {}),
          last_webhook_status: paymentStatus,
        },
      })
      .where(eq(payments.id, lockedPayment.id));
    return { handled: true };
  }

  if (paymentStatus === "USER_DROPPED" || paymentStatus === "EXPIRED") {
    await tx
      .update(payments)
      .set({
        status: "expired",
        updatedAt: now,
        metadata: {
          ...(lockedPayment.metadata ?? {}),
          last_webhook_status: paymentStatus,
        },
      })
      .where(eq(payments.id, lockedPayment.id));
    return { handled: true };
  }

  if (paymentStatus !== "SUCCESS") {
    return { handled: true, skippedReason: "ignored_status" };
  }

  const [ledger] = await tx
    .select()
    .from(weeklyRevenueShareLedgers)
    .where(eq(weeklyRevenueShareLedgers.id, ledgerId))
    .for("update")
    .limit(1);

  if (!ledger) {
    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: now,
        metadata: {
          ...(lockedPayment.metadata ?? {}),
          webhook_error: "ledger_not_found",
        },
      })
      .where(eq(payments.id, lockedPayment.id));
    return { handled: true, skippedReason: "ledger_not_found" };
  }

  if (ledger.userId !== lockedPayment.userId) {
    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: now,
        metadata: {
          ...(lockedPayment.metadata ?? {}),
          webhook_error: "ledger_user_mismatch",
        },
      })
      .where(eq(payments.id, lockedPayment.id));
    return { handled: true, skippedReason: "user_mismatch" };
  }

  const due = Number(ledger.amountDueInr);
  const prevPaid = Number(ledger.amountPaidInr);
  const payAmt = Number(lockedPayment.amountInr);
  if (
    !Number.isFinite(due) ||
    !Number.isFinite(prevPaid) ||
    !Number.isFinite(payAmt)
  ) {
    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: now,
        metadata: {
          ...(lockedPayment.metadata ?? {}),
          webhook_error: "invalid_numeric_amounts",
        },
      })
      .where(eq(payments.id, lockedPayment.id));
    return { handled: true, skippedReason: "invalid_amounts" };
  }

  const { newPaid, fullySettled } = applyRevenuePaymentToLedgerAmounts({
    amountDueInr: due,
    amountPaidInr: prevPaid,
    paymentAmountInr: payAmt,
  });
  const newLedgerStatus = fullySettled ? ("paid" as const) : ("partial" as const);

  await tx
    .update(weeklyRevenueShareLedgers)
    .set({
      amountPaidInr: money2(newPaid),
      status: newLedgerStatus,
      paidAt: fullySettled ? now : ledger.paidAt,
      updatedAt: now,
      metadata: {
        ...(ledger.metadata ?? {}),
        last_revenue_payment_id: lockedPayment.id,
      },
    })
    .where(eq(weeklyRevenueShareLedgers.id, ledger.id));

  await tx
    .update(payments)
    .set({
      status: "success",
      subscriptionId: ledger.subscriptionId,
      strategyId: ledger.strategyId,
      externalPaymentId: externalPaymentId ?? lockedPayment.externalPaymentId,
      updatedAt: now,
      metadata: {
        ...(lockedPayment.metadata ?? {}),
        last_webhook_status: paymentStatus,
        payment_product: "revenue_share",
        revenue_share_ledger_id: ledger.id,
      },
    })
    .where(eq(payments.id, lockedPayment.id));

  const [strategyRow] = await tx
    .select({ name: strategies.name })
    .from(strategies)
    .where(eq(strategies.id, ledger.strategyId))
    .limit(1);

  const [existingInvoice] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paymentId, lockedPayment.id))
    .limit(1);

  if (!existingInvoice) {
    const weekLabel = `${ledger.weekStartDateIst} → ${ledger.weekEndDateIst}`;
    await tx.insert(invoices).values({
      paymentId: lockedPayment.id,
      invoiceNumber: invoiceNumberForPayment(lockedPayment.id),
      amountInr: lockedPayment.amountInr,
      taxAmountInr: "0",
      lineDescription: strategyRow?.name
        ? `Weekly revenue share — ${strategyRow.name} (${weekLabel} IST)`
        : `Weekly revenue share (${weekLabel} IST)`,
      status: "paid",
      issuedAt: now,
    });
  }

  return {
    handled: true,
    releaseRevenueBlockForUserId: lockedPayment.userId,
    billingPaymentSuccess: {
      kind: "revenue_share",
      userId: lockedPayment.userId,
      paymentId: lockedPayment.id,
      amountInr: String(lockedPayment.amountInr),
      strategyName: strategyRow?.name ?? null,
      weekStartIst: String(ledger.weekStartDateIst),
      weekEndIst: String(ledger.weekEndDateIst),
    },
  };
}
