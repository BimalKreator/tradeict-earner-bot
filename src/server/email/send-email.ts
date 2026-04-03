import nodemailer from "nodemailer";

import { emailLogs } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

import {
  getFromAddress,
  getFromDisplayName,
  getSmtpConfig,
} from "./config";

export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  templateKey: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let db;
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
    await db.insert(emailLogs).values({
      toEmail: opts.to,
      subject: opts.subject,
      templateKey: opts.templateKey,
      status: "failed",
      errorMessage: "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)",
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

    await db.insert(emailLogs).values({
      toEmail: opts.to,
      subject: opts.subject,
      templateKey: opts.templateKey,
      status: "sent",
      providerMessageId: info.messageId ?? undefined,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email] send failed:", msg);
    await db.insert(emailLogs).values({
      toEmail: opts.to,
      subject: opts.subject,
      templateKey: opts.templateKey,
      status: "failed",
      errorMessage: msg,
    });
    return { ok: false, reason: "send_failed" };
  }
}
