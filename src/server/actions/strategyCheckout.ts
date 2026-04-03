"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { getAppBaseUrl, isCashfreeProduction } from "@/server/payments/cashfree/app-url";
import { createCashfreePgOrder } from "@/server/payments/cashfree/create-order";
import { requireUserId } from "@/server/auth/require-user";
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

export type StartStrategyCheckoutResult =
  | {
      ok: true;
      paymentSessionId: string;
      paymentId: string;
      cashfreeMode: "sandbox" | "production";
    }
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
    paymentSessionId: cf.paymentSessionId,
    paymentId: payId,
    cashfreeMode: isCashfreeProduction() ? "production" : "sandbox",
  };
}
