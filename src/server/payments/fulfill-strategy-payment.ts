import { and, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";
import {
  invoices,
  payments,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";

type DbClient = PostgresJsDatabase<typeof schema>;

const MS_PER_DAY = 86400000;

/**
 * ## Subscription renewal stacking (SUCCESS webhook)
 *
 * We keep **one** `user_strategy_subscriptions` row per (user_id, strategy_id) for
 * the latest logical subscription: fulfillment loads the newest non-deleted row
 * by `created_at` and updates **that same row** — it does not insert a duplicate
 * subscription when renewing.
 *
 * **Extension math (must match checkout renewal forecast):**
 * - `extendMs = access_days_purchased * MS_PER_DAY` (default 30 days).
 * - `anchorMs = max(now.getTime(), current.access_valid_until.getTime())`.
 * - New `access_valid_until = new Date(anchorMs + extendMs)`.
 *
 * So if access is still active, new time stacks **on top of** the current end
 * (user does not lose remaining days). If access has **lapsed**, `current_end`
 * is in the past, `anchorMs === now`, and the new window starts **from payment
 * time** (typical re-subscribe after expiry).
 *
 * **UTC vs IST:** `access_valid_until` is stored as `timestamptz` (absolute
 * instant in UTC internally). All comparisons use JavaScript `Date` (epoch ms).
 * **IST is not used in this calculation** — only for display strings in the UI
 * (e.g. “New expiry” on checkout). If product rules ever require “calendar
 * midnight in IST” boundaries, that would be a separate explicit change.
 */

async function ensureRunReadyToActivate(
  tx: DbClient,
  subscriptionId: string,
  now: Date,
): Promise<void> {
  await tx
    .insert(userStrategyRuns)
    .values({
      subscriptionId,
      status: "ready_to_activate",
      updatedAt: now,
    })
    .onConflictDoNothing({ target: userStrategyRuns.subscriptionId });
}

function invoiceNumberForPayment(paymentId: string): string {
  const y = new Date().getUTCFullYear();
  const compact = paymentId.replace(/-/g, "").slice(0, 12).toUpperCase();
  return `TE-${y}-${compact}`;
}

export type WebhookFulfillmentInput = {
  orderId: string;
  paymentStatus: "SUCCESS" | "FAILED" | "USER_DROPPED" | "EXPIRED" | "UNKNOWN";
  externalPaymentId: string | null;
};

/**
 * Idempotent subscription + invoice fulfillment under `SERIALIZABLE`-style safety:
 * locks the `payments` row with `FOR UPDATE` first, then the latest subscription row.
 */
export async function fulfillStrategyPaymentFromWebhook(
  tx: DbClient,
  input: WebhookFulfillmentInput,
): Promise<{ handled: boolean; skippedReason?: string }> {
  const { orderId, paymentStatus, externalPaymentId } = input;

  const [lockedPayment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.externalOrderId, orderId))
    .for("update")
    .limit(1);

  if (!lockedPayment) {
    return { handled: false, skippedReason: "payment_not_found" };
  }

  if (lockedPayment.status === "success") {
    return { handled: true, skippedReason: "already_success" };
  }

  if (!lockedPayment.strategyId) {
    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: new Date(),
        metadata: {
          ...(lockedPayment.metadata ?? {}),
          webhook_error: "missing_strategy_id_on_payment",
        },
      })
      .where(eq(payments.id, lockedPayment.id));
    return { handled: true, skippedReason: "invalid_payment_row" };
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

  const days = lockedPayment.accessDaysPurchased ?? 30;
  const extendMs = days * MS_PER_DAY;

  const [strategyRow] = await tx
    .select({ name: strategies.name })
    .from(strategies)
    .where(eq(strategies.id, lockedPayment.strategyId))
    .limit(1);

  const [latestSub] = await tx
    .select()
    .from(userStrategySubscriptions)
    .where(
      and(
        eq(userStrategySubscriptions.userId, lockedPayment.userId),
        eq(userStrategySubscriptions.strategyId, lockedPayment.strategyId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .orderBy(desc(userStrategySubscriptions.createdAt))
    .for("update")
    .limit(1);

  let subscriptionId: string;

  if (!latestSub) {
    const accessValidUntil = new Date(Date.now() + extendMs);
    const [inserted] = await tx
      .insert(userStrategySubscriptions)
      .values({
        userId: lockedPayment.userId,
        strategyId: lockedPayment.strategyId,
        status: "active",
        accessValidUntil,
        purchasedAt: now,
        firstActivationAt: now,
        updatedAt: now,
      })
      .returning({ id: userStrategySubscriptions.id });
    subscriptionId = inserted!.id;
    await ensureRunReadyToActivate(tx, subscriptionId, now);
  } else {
    const anchorMs = Math.max(
      now.getTime(),
      latestSub.accessValidUntil.getTime(),
    );
    const accessValidUntil = new Date(anchorMs + extendMs);
    await tx
      .update(userStrategySubscriptions)
      .set({
        status: "active",
        accessValidUntil,
        firstActivationAt: latestSub.firstActivationAt ?? now,
        updatedAt: now,
      })
      .where(eq(userStrategySubscriptions.id, latestSub.id));
    subscriptionId = latestSub.id;
    await ensureRunReadyToActivate(tx, subscriptionId, now);
  }

  await tx
    .update(payments)
    .set({
      status: "success",
      subscriptionId,
      externalPaymentId: externalPaymentId ?? lockedPayment.externalPaymentId,
      updatedAt: now,
      metadata: {
        ...(lockedPayment.metadata ?? {}),
        last_webhook_status: paymentStatus,
      },
    })
    .where(eq(payments.id, lockedPayment.id));

  const [existingInvoice] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paymentId, lockedPayment.id))
    .limit(1);

  if (!existingInvoice) {
    await tx.insert(invoices).values({
      paymentId: lockedPayment.id,
      invoiceNumber: invoiceNumberForPayment(lockedPayment.id),
      amountInr: lockedPayment.amountInr,
      taxAmountInr: "0",
      lineDescription: strategyRow?.name
        ? `Strategy subscription — ${strategyRow.name}`
        : "Strategy subscription",
      status: "paid",
      issuedAt: now,
    });
  }

  return { handled: true };
}
