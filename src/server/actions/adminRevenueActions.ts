"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminId } from "@/server/auth/require-admin-id";
import {
  auditLogs,
  feeWaivers,
  payments,
  strategies,
  users,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { sendTransactionalEmail } from "@/server/email/send-email";
import { getAppBaseUrl } from "@/server/payments/cashfree/app-url";

function money2(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function outstandingInr(due: string, paid: string): number {
  const d = Number(due);
  const p = Number(paid);
  if (!Number.isFinite(d) || !Number.isFinite(p)) return 0;
  return Math.max(0, d - p);
}

export type AdminRevenueActionState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

const ledgerIdSchema = z.string().uuid();
const notesSchema = z.string().trim().max(5000);

function revalidateRevenueViews(userId?: string) {
  revalidatePath("/admin/revenue");
  if (userId) {
    revalidatePath(`/admin/revenue/users/${userId}`);
    revalidatePath(`/admin/users/${userId}`);
  }
  revalidatePath("/user/funds");
}

/**
 * Apply a fee waiver against a weekly revenue ledger: lowers `amount_due_inr` (never below
 * `amount_paid_inr`), inserts `fee_waivers`, and writes `audit_logs`.
 */
export async function adminApplyFeeWaiverFormAction(
  _prev: AdminRevenueActionState,
  formData: FormData,
): Promise<AdminRevenueActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const rawAmount = formData.get("amountInr");
  const rawPercent = formData.get("percent");
  const rawLedger = formData.get("ledgerId");
  const rawReason = formData.get("reason");
  const parsed = z
    .object({
      ledgerId: ledgerIdSchema,
      reason: z.string().trim().min(1, "Reason is required.").max(2000),
      amountInr: z.string().trim().optional(),
      percent: z.string().trim().optional(),
    })
    .safeParse({
      ledgerId: typeof rawLedger === "string" ? rawLedger : "",
      reason: typeof rawReason === "string" ? rawReason : "",
      amountInr:
        typeof rawAmount === "string" ? rawAmount : undefined,
      percent:
        typeof rawPercent === "string" ? rawPercent : undefined,
    });

  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    const msg =
      f.ledgerId?.[0] ??
      f.reason?.[0] ??
      "Invalid input.";
    return { ok: false, message: msg };
  }

  const { ledgerId, reason } = parsed.data;
  const amtStr = parsed.data.amountInr?.trim() ?? "";
  const pctStr = parsed.data.percent?.trim() ?? "";
  const hasAmt = amtStr.length > 0;
  const hasPct = pctStr.length > 0;

  if (hasAmt === hasPct) {
    return {
      ok: false,
      message: "Provide exactly one of amount (INR) or percent.",
    };
  }

  let waiverInr = 0;
  if (hasAmt) {
    const n = Number(amtStr);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, message: "Amount must be a positive number." };
    }
    waiverInr = n;
  } else {
    const p = Number(pctStr);
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return { ok: false, message: "Percent must be between 0 and 100." };
    }
    // percent applied to outstanding at execution time
    waiverInr = p;
  }

  const database = requireDb();
  const now = new Date();

  try {
    const result = await database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock((SELECT hashtext(${ledgerId}::text))::bigint)`,
      );

      const [ledger] = await tx
        .select()
        .from(weeklyRevenueShareLedgers)
        .where(eq(weeklyRevenueShareLedgers.id, ledgerId))
        .for("update")
        .limit(1);

      if (!ledger) {
        return { err: "Ledger not found." as const };
      }

      if (ledger.status === "paid" || ledger.status === "waived") {
        return { err: "This ledger is already settled." as const };
      }

      const due = Number(ledger.amountDueInr);
      const paid = Number(ledger.amountPaidInr);
      if (!Number.isFinite(due) || !Number.isFinite(paid)) {
        return { err: "Invalid ledger amounts." as const };
      }

      const out = Math.max(0, due - paid);
      if (out < 0.01) {
        return { err: "Nothing left to waive on this ledger." as const };
      }

      let reduction = hasPct ? (out * waiverInr) / 100 : waiverInr;
      reduction = Math.min(reduction, out);
      if (reduction < 0.01) {
        return { err: "Waiver amount is too small." as const };
      }

      const newDue = money2(due - reduction);
      const newDueNum = Number(newDue);
      const outstandingAfter = Math.max(0, newDueNum - paid);

      let nextStatus: "unpaid" | "partial" | "paid" | "waived";
      let paidAt = ledger.paidAt;

      if (outstandingAfter < 0.01) {
        if (paid >= 0.01) {
          nextStatus = "paid";
          paidAt = paidAt ?? now;
        } else {
          nextStatus = "waived";
        }
      } else if (paid >= 0.01) {
        nextStatus = "partial";
      } else {
        nextStatus = "unpaid";
      }

      await tx.insert(feeWaivers).values({
        userId: ledger.userId,
        strategyId: ledger.strategyId,
        subscriptionId: ledger.subscriptionId,
        revenueLedgerId: ledger.id,
        amountInr: money2(reduction),
        reason,
        createdByAdminId: adminId,
      });

      await tx
        .update(weeklyRevenueShareLedgers)
        .set({
          amountDueInr: newDue,
          status: nextStatus,
          paidAt,
          updatedAt: now,
          metadata: {
            ...((ledger.metadata as Record<string, unknown> | null) ?? {}),
            last_fee_waiver_at: now.toISOString(),
          },
        })
        .where(eq(weeklyRevenueShareLedgers.id, ledger.id));

      await tx.insert(auditLogs).values({
        actorType: "admin",
        actorAdminId: adminId,
        action: "billing.fee_waiver_applied",
        entityType: "weekly_revenue_share_ledger",
        entityId: ledger.id,
        metadata: {
          target_user_id: ledger.userId,
          waiver_amount_inr: money2(reduction),
          previous_amount_due_inr: money2(due),
          new_amount_due_inr: newDue,
          amount_paid_inr: money2(paid),
          reason,
          ledger_status_after: nextStatus,
        },
      });

      return {
        ok: true as const,
        userId: ledger.userId,
        message: `Waiver of ₹${money2(reduction)} applied. Ledger is now ${nextStatus}.`,
      };
    });

    if ("ok" in result && result.ok) {
      revalidateRevenueViews(result.userId);
      return { ok: true, message: result.message };
    }

    return {
      ok: false,
      message: "err" in result ? result.err : "Could not apply waiver.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin] fee waiver failed:", msg);
    return { ok: false, message: "Could not apply waiver. Try again." };
  }
}

export async function adminSendPaymentReminderFormAction(
  _prev: AdminRevenueActionState,
  formData: FormData,
): Promise<AdminRevenueActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const lid = formData.get("ledgerId");
  const parsed = z
    .object({ ledgerId: ledgerIdSchema })
    .safeParse({ ledgerId: typeof lid === "string" ? lid : "" });

  if (!parsed.success) {
    return { ok: false, message: "Invalid ledger." };
  }

  const { ledgerId } = parsed.data;
  const database = requireDb();
  const base = getAppBaseUrl();

  const [row] = await database
    .select({
      userId: weeklyRevenueShareLedgers.userId,
      email: users.email,
      weekStart: weeklyRevenueShareLedgers.weekStartDateIst,
      weekEnd: weeklyRevenueShareLedgers.weekEndDateIst,
      due: weeklyRevenueShareLedgers.amountDueInr,
      paid: weeklyRevenueShareLedgers.amountPaidInr,
      status: weeklyRevenueShareLedgers.status,
      strategyName: strategies.name,
    })
    .from(weeklyRevenueShareLedgers)
    .innerJoin(users, eq(users.id, weeklyRevenueShareLedgers.userId))
    .innerJoin(
      strategies,
      eq(strategies.id, weeklyRevenueShareLedgers.strategyId),
    )
    .where(eq(weeklyRevenueShareLedgers.id, ledgerId))
    .limit(1);

  if (!row) {
    return { ok: false, message: "Ledger not found." };
  }

  if (row.status === "paid" || row.status === "waived") {
    return { ok: false, message: "Nothing to remind for this ledger." };
  }

  const out = outstandingInr(String(row.due), String(row.paid));
  if (out < 0.01) {
    return { ok: false, message: "Nothing due on this ledger." };
  }

  const fundsUrl = `${base}/user/funds?tab=platform`;
  const subject = `Tradeict Earner — revenue share payment due (week ${String(row.weekStart)} IST)`;
  const text = [
    `Hello,`,
    ``,
    `You have an outstanding revenue-share balance for strategy "${row.strategyName ?? "your strategy"}" for the IST week ${String(row.weekStart)}–${String(row.weekEnd)}.`,
    `Amount remaining: ₹${money2(out)}.`,
    ``,
    `Pay securely in your dashboard: ${fundsUrl}`,
    ``,
    `— Tradeict Earner`,
  ].join("\n");

  const html = `
    <p>Hello,</p>
    <p>You have an outstanding revenue-share balance for strategy <strong>${escapeHtml(row.strategyName ?? "your strategy")}</strong>
    for the IST week <strong>${escapeHtml(String(row.weekStart))}</strong>–<strong>${escapeHtml(String(row.weekEnd))}</strong>.</p>
    <p>Amount remaining: <strong>₹${money2(out)}</strong>.</p>
    <p><a href="${fundsUrl}">Open your funds page to pay</a></p>
    <p>— Tradeict Earner</p>
  `;

  const sent = await sendTransactionalEmail({
    to: row.email,
    subject,
    text,
    html,
    templateKey: "billing.revenue_share_reminder",
  });

  await database.insert(auditLogs).values({
    actorType: "admin",
    actorAdminId: adminId,
    action: "billing.payment_reminder_sent",
    entityType: "weekly_revenue_share_ledger",
    entityId: ledgerId,
    metadata: {
      target_user_id: row.userId,
      to_email: row.email,
      outstanding_inr: money2(out),
      email_ok: sent.ok,
      email_reason: sent.ok ? undefined : sent.reason,
    },
  });

  revalidateRevenueViews(row.userId);

  if (!sent.ok) {
    return {
      ok: false,
      message: `Reminder logged but email failed (${sent.reason}).`,
    };
  }

  return { ok: true, message: "Reminder email sent." };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function adminSaveLedgerNotesFormAction(
  _prev: AdminRevenueActionState,
  formData: FormData,
): Promise<AdminRevenueActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const ln = formData.get("ledgerId");
  const an = formData.get("adminNotes");
  const parsed = z
    .object({
      ledgerId: ledgerIdSchema,
      adminNotes: notesSchema,
    })
    .safeParse({
      ledgerId: typeof ln === "string" ? ln : "",
      adminNotes: typeof an === "string" ? an : "",
    });

  if (!parsed.success) {
    return { ok: false, message: "Invalid input." };
  }

  const { ledgerId, adminNotes } = parsed.data;
  const database = requireDb();
  const now = new Date();

  const [ledger] = await database
    .select({
      userId: weeklyRevenueShareLedgers.userId,
      prev: weeklyRevenueShareLedgers.adminNotes,
    })
    .from(weeklyRevenueShareLedgers)
    .where(eq(weeklyRevenueShareLedgers.id, ledgerId))
    .limit(1);

  if (!ledger) {
    return { ok: false, message: "Ledger not found." };
  }

  await database
    .update(weeklyRevenueShareLedgers)
    .set({ adminNotes: adminNotes.length ? adminNotes : null, updatedAt: now })
    .where(eq(weeklyRevenueShareLedgers.id, ledgerId));

  await database.insert(auditLogs).values({
    actorType: "admin",
    actorAdminId: adminId,
    action: "billing.ledger_admin_notes_updated",
    entityType: "weekly_revenue_share_ledger",
    entityId: ledgerId,
    metadata: {
      target_user_id: ledger.userId,
      previous_note: ledger.prev ?? null,
      new_note: adminNotes.length ? adminNotes : null,
    },
  });

  revalidateRevenueViews(ledger.userId);
  return { ok: true, message: "Ledger notes saved." };
}

export async function adminSavePaymentNotesFormAction(
  _prev: AdminRevenueActionState,
  formData: FormData,
): Promise<AdminRevenueActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const pid = formData.get("paymentId");
  const pan = formData.get("adminNotes");
  const parsed = z
    .object({
      paymentId: ledgerIdSchema,
      adminNotes: notesSchema,
    })
    .safeParse({
      paymentId: typeof pid === "string" ? pid : "",
      adminNotes: typeof pan === "string" ? pan : "",
    });

  if (!parsed.success) {
    return { ok: false, message: "Invalid input." };
  }

  const { paymentId, adminNotes } = parsed.data;
  const database = requireDb();
  const now = new Date();

  const [pay] = await database
    .select({
      userId: payments.userId,
      prev: payments.adminNotes,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!pay) {
    return { ok: false, message: "Payment not found." };
  }

  await database
    .update(payments)
    .set({ adminNotes: adminNotes.length ? adminNotes : null, updatedAt: now })
    .where(eq(payments.id, paymentId));

  await database.insert(auditLogs).values({
    actorType: "admin",
    actorAdminId: adminId,
    action: "billing.payment_admin_notes_updated",
    entityType: "payment",
    entityId: paymentId,
    metadata: {
      target_user_id: pay.userId,
      previous_note: pay.prev ?? null,
      new_note: adminNotes.length ? adminNotes : null,
    },
  });

  revalidateRevenueViews(pay.userId);
  return { ok: true, message: "Payment notes saved." };
}

const BULK_REMINDER_MAX = 25;

/**
 * Sends one reminder email per ledger id (cap {@link BULK_REMINDER_MAX}). Each send is audited.
 */
export async function adminBulkPaymentReminderFormAction(
  _prev: AdminRevenueActionState,
  formData: FormData,
): Promise<AdminRevenueActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { ok: false, message: "Unauthorized." };
  }

  const raw = formData.get("ledgerIds");
  const text = typeof raw === "string" ? raw : "";
  const ids = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, BULK_REMINDER_MAX);

  const parsedIds = ids
    .map((id) => ledgerIdSchema.safeParse(id))
    .filter((r) => r.success)
    .map((r) => r.data);

  if (parsedIds.length === 0) {
    return {
      ok: false,
      message: `Paste up to ${BULK_REMINDER_MAX} valid ledger UUIDs.`,
    };
  }

  let emailsOk = 0;
  let emailsFail = 0;

  for (const ledgerId of parsedIds) {
    const fd = new FormData();
    fd.set("ledgerId", ledgerId);
    const res = await adminSendPaymentReminderFormAction(null, fd);
    if (res?.ok) emailsOk += 1;
    else emailsFail += 1;
  }

  await requireDb().insert(auditLogs).values({
    actorType: "admin",
    actorAdminId: adminId,
    action: "billing.bulk_payment_reminder",
    entityType: "weekly_revenue_share_ledger",
    metadata: {
      ledger_ids: parsedIds,
      emails_ok: emailsOk,
      emails_fail: emailsFail,
    },
  });

  revalidatePath("/admin/revenue");

  return {
    ok: true,
    message: `Bulk reminder finished: ${emailsOk} sent, ${emailsFail} skipped or failed.`,
  };
}
