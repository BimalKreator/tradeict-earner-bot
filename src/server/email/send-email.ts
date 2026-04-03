import nodemailer from "nodemailer";

import { emailLogs, notificationLogs } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

import {
  getFromAddress,
  getFromDisplayName,
  getSmtpConfig,
} from "./config";

async function writeEmailAndNotificationRow(opts: {
  db: ReturnType<typeof requireDb>;
  to: string;
  subject: string;
  templateKey: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  errorMessage?: string;
  userId?: string | null;
  notificationMetadata?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  const meta = {
    to: opts.to,
    subject: opts.subject,
    ...(opts.notificationMetadata ?? {}),
  };
  await opts.db.insert(emailLogs).values({
    toEmail: opts.to,
    subject: opts.subject,
    templateKey: opts.templateKey,
    status: opts.status,
    providerMessageId: opts.providerMessageId,
    errorMessage: opts.errorMessage,
  });
  await opts.db.insert(notificationLogs).values({
    userId: opts.userId ?? null,
    type: opts.templateKey,
    channel: "email",
    status: opts.status,
    metadata: meta,
    sentAt: now,
  });
}

export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  templateKey: string;
  /** When known, links the row to `users.id` for admin auditing. */
  userId?: string | null;
  notificationMetadata?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let db: ReturnType<typeof requireDb>;
  try {
    db = requireDb();
  } catch {
    console.error("sendTransactionalEmail: no database");
    return { ok: false, reason: "no_database" };
  }

  const cfg = getSmtpConfig();
  if (!cfg) {
    console.warn(
      "[email] SMTP not configured; skipping send:",
      opts.templateKey,
      opts.to,
    );
    await writeEmailAndNotificationRow({
      db,
      to: opts.to,
      subject: opts.subject,
      templateKey: opts.templateKey,
      status: "failed",
      errorMessage:
        "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)",
      userId: opts.userId,
      notificationMetadata: opts.notificationMetadata,
    });
    return { ok: false, reason: "smtp_not_configured" };
  }

  const fromAddr = getFromAddress();
  const fromName = getFromDisplayName();

  try {
    const transporter = nodemailer.createTransport(cfg);
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddr}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });

    await writeEmailAndNotificationRow({
      db,
      to: opts.to,
      subject: opts.subject,
      templateKey: opts.templateKey,
      status: "sent",
      providerMessageId: info.messageId ?? undefined,
      userId: opts.userId,
      notificationMetadata: opts.notificationMetadata,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email] send failed:", msg);
    await writeEmailAndNotificationRow({
      db,
      to: opts.to,
      subject: opts.subject,
      templateKey: opts.templateKey,
      status: "failed",
      errorMessage: msg,
      userId: opts.userId,
      notificationMetadata: opts.notificationMetadata,
    });
    return { ok: false, reason: "send_failed" };
  }
}
