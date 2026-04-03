"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { requireUserId } from "@/server/auth/require-user";
import { payments, users, weeklyRevenueShareLedgers } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { getAppBaseUrl, isCashfreeProduction } from "@/server/payments/cashfree/app-url";
import { createCashfreePgOrder } from "@/server/payments/cashfree/create-order";

const INFLIGHT_WINDOW_MS = 30 * 60 * 1000;

const ledgerIdSchema = z.string().uuid();

class RevenueCheckoutInflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevenueCheckoutInflightError";
  }
}

export type PayRevenueShareResult =
  | {
      ok: true;
      paymentSessionId: string;
      paymentId: string;
      cashfreeMode: "sandbox" | "production";
    }
  | { ok: false; error: string };

function outstandingInr(due: string, paid: string): number {
  const d = Number(due);
  const p = Number(paid);
  if (!Number.isFinite(d) || !Number.isFinite(p)) return 0;
  return Math.max(0, d - p);
}

/**
 * Starts Cashfree PG checkout for the **remaining** balance on a weekly revenue ledger.
 * Creates a `payments` row with `revenue_share_ledger_id` set (webhook routes by that FK).
 */
export async function payRevenueShareAction(
  ledgerId: string,
): Promise<PayRevenueShareResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "Please sign in to continue." };
  }

  const parsedId = ledgerIdSchema.safeParse(ledgerId);
  if (!parsedId.success) {
    return { ok: false, error: "Invalid ledger." };
  }

  const database = requireDb();
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - INFLIGHT_WINDOW_MS);

  try {
    const { payId, amountStr } = await database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock((SELECT hashtext(${parsedId.data}::text))::bigint)`,
      );

      const [ledger] = await tx
        .select()
        .from(weeklyRevenueShareLedgers)
        .where(
          and(
            eq(weeklyRevenueShareLedgers.id, parsedId.data),
            eq(weeklyRevenueShareLedgers.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      if (!ledger) {
        throw new Error("ledger_not_found");
      }

      if (ledger.status === "paid" || ledger.status === "waived") {
        throw new Error("ledger_not_payable");
      }

      const remaining = outstandingInr(
        String(ledger.amountDueInr),
        String(ledger.amountPaidInr),
      );
      if (remaining < 0.01) {
        throw new Error("nothing_due");
      }

      const inflight = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.revenueShareLedgerId, parsedId.data),
            inArray(payments.status, ["created", "pending"]),
            gte(payments.updatedAt, thirtyMinutesAgo),
          ),
        )
        .limit(1);

      if (inflight.length > 0) {
        throw new RevenueCheckoutInflightError(
          "A payment is already in progress for this week. Complete it on Cashfree or wait up to 30 minutes.",
        );
      }

      const amountStr = remaining.toFixed(2);

      const [pay] = await tx
        .insert(payments)
        .values({
          userId,
          strategyId: ledger.strategyId,
          subscriptionId: ledger.subscriptionId,
          revenueShareLedgerId: ledger.id,
          amountInr: amountStr,
          currency: "INR",
          status: "created",
          accessDaysPurchased: 0,
          metadata: {
            payment_product: "revenue_share",
            ledger_week_start_ist: String(ledger.weekStartDateIst),
            ledger_week_end_ist: String(ledger.weekEndDateIst),
          },
          updatedAt: now,
        })
        .returning({ id: payments.id });

      if (!pay) throw new Error("payment_insert_failed");

      await tx
        .update(payments)
        .set({
          externalOrderId: pay.id,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, pay.id));

      return { payId: pay.id, amountStr };
    });

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

    const base = getAppBaseUrl();
    const returnUrl = `${base}/user/funds?tab=platform&revPay=${encodeURIComponent(payId)}`;

    const cf = await createCashfreePgOrder({
      orderId: payId,
      amountInr: amountStr,
      customerId: userId,
      customerEmail,
      customerPhone,
      returnUrl,
    });

    if (!cf.ok) {
      const [prevMeta] = await database
        .select({ metadata: payments.metadata })
        .from(payments)
        .where(eq(payments.id, payId))
        .limit(1);
      await database
        .update(payments)
        .set({
          status: "failed",
          updatedAt: new Date(),
          metadata: {
            ...((prevMeta?.metadata as Record<string, unknown> | null) ?? {}),
            payment_product: "revenue_share",
            cashfree_error: cf.message,
          },
        })
        .where(eq(payments.id, payId));
      return {
        ok: false,
        error: cf.message || "Payment gateway error. Try again later.",
      };
    }

    const [pendMeta] = await database
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.id, payId))
      .limit(1);
    await database
      .update(payments)
      .set({
        status: "pending",
        updatedAt: new Date(),
        metadata: {
          ...((pendMeta?.metadata as Record<string, unknown> | null) ?? {}),
          payment_product: "revenue_share",
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
  } catch (e) {
    if (e instanceof RevenueCheckoutInflightError) {
      return { ok: false, error: e.message };
    }
    const code = e instanceof Error ? e.message : String(e);
    if (code === "ledger_not_found") {
      return { ok: false, error: "Ledger not found." };
    }
    if (code === "ledger_not_payable") {
      return { ok: false, error: "This week is already settled or waived." };
    }
    if (code === "nothing_due") {
      return { ok: false, error: "Nothing left to pay on this ledger." };
    }
    return { ok: false, error: "Could not start checkout. Try again shortly." };
  }
}
