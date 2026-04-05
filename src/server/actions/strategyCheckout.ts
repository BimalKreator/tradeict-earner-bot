"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { getAppBaseUrl, isCashfreeProduction } from "@/server/payments/cashfree/app-url";
import { createCashfreePgOrder } from "@/server/payments/cashfree/create-order";
import type { BillingPaymentSuccessEmailPayload } from "@/server/payments/cashfree/parse-webhook";
import { applyStrategySubscriptionFulfillmentTx } from "@/server/payments/fulfill-strategy-payment";
import { requireUserId } from "@/server/auth/require-user";
import { sendBillingPaymentSuccessEmailAfterWebhook } from "@/server/notifications/send-billing-payment-success-email";
import { payments, users } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { resolveStrategyCheckoutQuote } from "@/server/queries/strategy-checkout-price";

const INFLIGHT_WINDOW_MS = 30 * 60 * 1000;

class CheckoutInflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutInflightError";
  }
}

function isZeroMonthlyFeeInr(feeStr: string): boolean {
  const n = Number(feeStr);
  return Number.isFinite(n) && n === 0;
}

export type StartStrategyCheckoutResult =
  | {
      ok: true;
      mode: "cashfree";
      paymentSessionId: string;
      paymentId: string;
      cashfreeMode: "sandbox" | "production";
    }
  | { ok: true; mode: "free"; paymentId: string }
  | { ok: false; error: string };

export async function startStrategyCheckoutAction(
  strategySlug: string,
): Promise<StartStrategyCheckoutResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "Please sign in to continue." };
  }

  const slug = strategySlug.trim();
  if (!slug) {
    return { ok: false, error: "Invalid strategy." };
  }

  const database = requireDb();

  const quote = await resolveStrategyCheckoutQuote(userId, slug);
  if (!quote) {
    return { ok: false, error: "Strategy is not available for purchase." };
  }

  const [userRow] = await database
    .select({
      email: users.email,
      phone: users.phone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow) {
    return { ok: false, error: "Account not found." };
  }

  const customerPhone = (userRow.phone?.replace(/\s/g, "") || "9999999999").slice(
    0,
    15,
  );
  const customerEmail = userRow.email;

  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - INFLIGHT_WINDOW_MS);

  if (isZeroMonthlyFeeInr(quote.monthlyFeeInr)) {
    let billingReceipt: BillingPaymentSuccessEmailPayload | undefined;
    let payId: string;
    try {
      payId = await database.transaction(async (tx) => {
        const lockKey = `${userId}:${quote.strategyId}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock((SELECT hashtext(${lockKey}))::bigint)`,
        );

        const inflightRows = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.userId, userId),
              eq(payments.strategyId, quote.strategyId),
              inArray(payments.status, ["created", "pending"]),
              gte(payments.updatedAt, thirtyMinutesAgo),
            ),
          )
          .limit(1);

        if (inflightRows.length > 0) {
          throw new CheckoutInflightError(
            "A payment is already in progress for this strategy. Complete it on Cashfree or wait up to 30 minutes before trying again.",
          );
        }

        const [pay] = await tx
          .insert(payments)
          .values({
            userId,
            strategyId: quote.strategyId,
            amountInr: "0.00",
            currency: "INR",
            status: "created",
            accessDaysPurchased: 30,
            metadata: {
              strategy_slug: quote.slug,
              revenue_share_percent_shown: quote.revenueSharePercent,
              pricing_override: quote.hasPricingOverride,
              free_activation: true,
            },
            updatedAt: now,
          })
          .returning({ id: payments.id });

        if (!pay) {
          throw new Error("payment_insert_failed");
        }

        await tx
          .update(payments)
          .set({
            externalOrderId: pay.id,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, pay.id));

        const [locked] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, pay.id))
          .for("update")
          .limit(1);

        if (!locked) {
          throw new Error("payment_lock_failed");
        }

        const { billingPaymentSuccess } =
          await applyStrategySubscriptionFulfillmentTx(tx, locked, now, {
            lastWebhookStatus: "FREE_ACTIVATION",
            externalPaymentId: null,
          });
        billingReceipt = billingPaymentSuccess;
        return pay.id;
      });
    } catch (e) {
      if (e instanceof CheckoutInflightError) {
        return { ok: false, error: e.message };
      }
      console.error("[strategyCheckout] free activation", e);
      return {
        ok: false,
        error: "Could not activate free subscription. Try again shortly.",
      };
    }

    revalidatePath("/user/strategies");
    revalidatePath(`/user/strategies/${encodeURIComponent(quote.slug)}/checkout`);
    revalidatePath("/user/my-strategies");

    if (billingReceipt) {
      void sendBillingPaymentSuccessEmailAfterWebhook(billingReceipt).catch(
        (err) => {
          console.error("[strategyCheckout] free activation email", err);
        },
      );
    }

    return { ok: true, mode: "free", paymentId: payId };
  }

  let payId: string;
  try {
    payId = await database.transaction(async (tx) => {
      const lockKey = `${userId}:${quote.strategyId}`;
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock((SELECT hashtext(${lockKey}))::bigint)`,
      );

      const inflightRows = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.userId, userId),
            eq(payments.strategyId, quote.strategyId),
            inArray(payments.status, ["created", "pending"]),
            gte(payments.updatedAt, thirtyMinutesAgo),
          ),
        )
        .limit(1);

      if (inflightRows.length > 0) {
        throw new CheckoutInflightError(
          "A payment is already in progress for this strategy. Complete it on Cashfree or wait up to 30 minutes before trying again.",
        );
      }

      const [pay] = await tx
        .insert(payments)
        .values({
          userId,
          strategyId: quote.strategyId,
          amountInr: quote.monthlyFeeInr,
          currency: "INR",
          status: "created",
          accessDaysPurchased: 30,
          metadata: {
            strategy_slug: quote.slug,
            revenue_share_percent_shown: quote.revenueSharePercent,
            pricing_override: quote.hasPricingOverride,
          },
          updatedAt: now,
        })
        .returning({ id: payments.id });

      if (!pay) {
        throw new Error("payment_insert_failed");
      }

      await tx
        .update(payments)
        .set({
          externalOrderId: pay.id,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, pay.id));

      return pay.id;
    });
  } catch (e) {
    if (e instanceof CheckoutInflightError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: "Could not start checkout. Please try again in a moment.",
    };
  }

  const base = getAppBaseUrl();
  const returnUrl = `${base}/user/strategies/${encodeURIComponent(quote.slug)}/checkout/return?paymentId=${payId}`;

  const cf = await createCashfreePgOrder({
    orderId: payId,
    amountInr: quote.monthlyFeeInr,
    customerId: userId,
    customerEmail,
    customerPhone,
    returnUrl,
  });

  if (!cf.ok) {
    await database
      .update(payments)
      .set({
        status: "failed",
        updatedAt: new Date(),
        metadata: {
          strategy_slug: quote.slug,
          cashfree_error: cf.message,
        },
      })
      .where(eq(payments.id, payId));
    return {
      ok: false,
      error: cf.message || "Payment gateway error. Try again later.",
    };
  }

  await database
    .update(payments)
    .set({
      status: "pending",
      updatedAt: new Date(),
      metadata: {
        strategy_slug: quote.slug,
        revenue_share_percent_shown: quote.revenueSharePercent,
        pricing_override: quote.hasPricingOverride,
        payment_session_id: cf.paymentSessionId,
      },
    })
    .where(eq(payments.id, payId));

  return {
    ok: true,
    mode: "cashfree",
    paymentSessionId: cf.paymentSessionId,
    paymentId: payId,
    cashfreeMode: isCashfreeProduction() ? "production" : "sandbox",
  };
}
