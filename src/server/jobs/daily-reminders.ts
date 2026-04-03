import { sql } from "drizzle-orm";

import { addCalendarDaysYmd, calendarDateIST } from "@/server/cron/ist-calendar";
import { requireDb } from "@/server/db/require-db";
import { sendTransactionalEmail } from "@/server/email/send-email";
import { getAppBaseUrl } from "@/server/payments/cashfree/app-url";
import {
  billingRevenueDueReminderEmail,
  billingSubscriptionExpiryReminderEmail,
} from "@/server/notifications/email-templates";

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

export type DailyRemindersResult = {
  ok: boolean;
  subscriptionRemindersSent: number;
  revenueRemindersSent: number;
  errors: string[];
};

/**
 * IST “expiry in 3 days” + overdue revenue ledgers. Dedupe via `notification_logs.metadata.trigger = daily_cron`.
 */
export async function runDailyReminders(): Promise<DailyRemindersResult> {
  const out: DailyRemindersResult = {
    ok: true,
    subscriptionRemindersSent: 0,
    revenueRemindersSent: 0,
    errors: [],
  };

  let database;
  try {
    database = requireDb();
  } catch {
    out.ok = false;
    out.errors.push("no_database");
    return out;
  }

  const istTargetEnd = addCalendarDaysYmd(calendarDateIST(), 3);
  const base = getAppBaseUrl().replace(/\/$/, "");

  try {
    const subResult = await database.execute(sql`
      SELECT
        uss.id AS subscription_id,
        uss.user_id,
        u.email,
        u.name,
        uss.access_valid_until,
        s.name AS strategy_name,
        s.slug AS strategy_slug
      FROM user_strategy_subscriptions uss
      INNER JOIN users u ON u.id = uss.user_id
      INNER JOIN strategies s ON s.id = uss.strategy_id
      WHERE uss.status = 'active'
        AND uss.deleted_at IS NULL
        AND u.deleted_at IS NULL
        AND to_char(timezone('Asia/Kolkata', uss.access_valid_until), 'YYYY-MM-DD') = ${istTargetEnd}
        AND NOT EXISTS (
          SELECT 1 FROM notification_logs nl
          WHERE nl.type = 'billing.subscription_expiry_reminder'
            AND nl.status = 'sent'
            AND nl.metadata->>'subscription_id' = uss.id::text
            AND nl.metadata->>'trigger' = 'daily_cron'
            AND to_char(timezone('Asia/Kolkata', nl.sent_at), 'YYYY-MM-DD') =
                to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD')
        )
    `);

    const subRows = Array.from(
      subResult as unknown as Iterable<Record<string, unknown>>,
    );

    for (const r of subRows) {
      const email = String(r.email ?? "");
      const userId = String(r.user_id ?? "");
      const subscriptionId = String(r.subscription_id ?? "");
      const slug = String(r.strategy_slug ?? "");
      const strategyName = String(r.strategy_name ?? "Strategy");
      const accessRaw = r.access_valid_until;
      if (!email || !userId || !subscriptionId || !slug || !accessRaw) continue;

      const accessValidUntil = new Date(String(accessRaw));
      if (Number.isNaN(accessValidUntil.getTime())) continue;

      const msLeft = accessValidUntil.getTime() - Date.now();
      const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));

      const body = billingSubscriptionExpiryReminderEmail({
        name: r.name != null ? String(r.name) : null,
        strategyName,
        strategySlug: slug,
        accessValidUntil,
        daysLeft,
      });

      const sent = await sendTransactionalEmail({
        to: email,
        subject: body.subject,
        text: body.text,
        html: body.html,
        templateKey: "billing.subscription_expiry_reminder",
        userId,
        notificationMetadata: {
          subscription_id: subscriptionId,
          strategy_slug: slug,
          trigger: "daily_cron",
          ist_target_end_date: istTargetEnd,
        },
      });

      if (sent.ok) out.subscriptionRemindersSent += 1;
      else
        out.errors.push(
          `subscription_reminder:${subscriptionId}:${sent.reason}`,
        );
    }
  } catch (e) {
    out.ok = false;
    out.errors.push(
      e instanceof Error ? e.message : "subscription_reminder_query_failed",
    );
  }

  try {
    const revResult = await database.execute(sql`
      SELECT
        wrsl.id AS ledger_id,
        wrsl.user_id,
        u.email,
        wrsl.week_start_date_ist,
        wrsl.week_end_date_ist,
        wrsl.amount_due_inr,
        wrsl.amount_paid_inr,
        s.name AS strategy_name
      FROM weekly_revenue_share_ledgers wrsl
      INNER JOIN users u ON u.id = wrsl.user_id
      INNER JOIN strategies s ON s.id = wrsl.strategy_id
      WHERE wrsl.status IN ('unpaid', 'partial')
        AND wrsl.due_at < now() - interval '24 hours'
        AND (wrsl.amount_due_inr::numeric - wrsl.amount_paid_inr::numeric) > 0.009
        AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM notification_logs nl
          WHERE nl.type = 'billing.revenue_due_reminder'
            AND nl.status = 'sent'
            AND nl.metadata->>'ledger_id' = wrsl.id::text
            AND nl.metadata->>'trigger' = 'daily_cron'
            AND nl.sent_at > now() - interval '72 hours'
        )
    `);

    const revRows = Array.from(
      revResult as unknown as Iterable<Record<string, unknown>>,
    );

    for (const r of revRows) {
      const email = String(r.email ?? "");
      const userId = String(r.user_id ?? "");
      const ledgerId = String(r.ledger_id ?? "");
      if (!email || !userId || !ledgerId) continue;

      const due = String(r.amount_due_inr ?? "0");
      const paid = String(r.amount_paid_inr ?? "0");
      const outAmt = outstandingInr(due, paid);
      if (outAmt < 0.01) continue;

      const weekStart = String(r.week_start_date_ist ?? "");
      const weekEnd = String(r.week_end_date_ist ?? "");
      const strategyName = String(r.strategy_name ?? "your strategy");
      const payUrl = `${base}/user/funds?tab=platform`;

      const body = billingRevenueDueReminderEmail({
        strategyName,
        weekStart,
        weekEnd,
        outstandingInr: money2(outAmt),
        payUrl,
      });

      const sent = await sendTransactionalEmail({
        to: email,
        subject: body.subject,
        text: body.text,
        html: body.html,
        templateKey: "billing.revenue_due_reminder",
        userId,
        notificationMetadata: {
          ledger_id: ledgerId,
          trigger: "daily_cron",
          outstanding_inr: money2(outAmt),
        },
      });

      if (sent.ok) out.revenueRemindersSent += 1;
      else out.errors.push(`revenue_reminder:${ledgerId}:${sent.reason}`);
    }
  } catch (e) {
    out.ok = false;
    out.errors.push(
      e instanceof Error ? e.message : "revenue_reminder_query_failed",
    );
  }

  return out;
}
