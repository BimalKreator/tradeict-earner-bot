import { getAppBaseUrl } from "@/server/payments/cashfree/app-url";

import { escapeHtml, wrapEmailBody } from "./email-html";

function siteBase(): string {
  return getAppBaseUrl().replace(/\/$/, "");
}

function ctaButton(href: string, label: string): string {
  const safe = href.replace(/"/g, "%22");
  return `<p style="margin:20px 0 0;"><a href="${safe}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:linear-gradient(135deg,#38bdf8,#0284c7);color:#020617;font-weight:700;text-decoration:none;">${escapeHtml(label)}</a></p>`;
}

function money2(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function formatIstDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

// --- Auth ---

export function registrationReceivedEmail(params: { name?: string | null }) {
  const name = params.name?.trim() || "there";
  const base = siteBase();
  const subject = "Tradeict Earner — registration received";
  const text = `Hi ${name},

We have received your registration for Tradeict Earner. Your account is pending admin approval.

You will receive another email when your account has been approved and you can complete sign-in (password + email OTP).

If you did not register, please ignore this message.

— Tradeict Earner
${base}
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">We have received your registration for <strong style="color:#e2e8f0;">Tradeict Earner</strong>. Your account is <strong style="color:#38bdf8;">pending approval</strong> by our team.</p>
<p style="margin:0 0 12px;">You will receive another email when your account is approved and you can sign in using your password and a one-time code sent to this address.</p>
<p style="margin:0;">If you did not register, you can ignore this email.</p>
`;
  return {
    subject,
    text,
    html: wrapEmailBody(inner, "Registration received — pending approval"),
  };
}

export function loginOtpEmail(params: { code: string }) {
  const subject = "Tradeict Earner — your login code";
  const text = `Your Tradeict Earner login code is: ${params.code}

This code expires in 10 minutes. If you did not try to sign in, ignore this email.

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Your <strong>Tradeict Earner</strong> login code is:</p>
<p style="margin:16px 0;font-size:30px;letter-spacing:6px;font-weight:800;color:#38bdf8;font-family:ui-monospace,monospace;">${escapeHtml(params.code)}</p>
<p style="margin:0;">This code expires in <strong>10 minutes</strong>. If you did not try to sign in, you can ignore this email.</p>
`;
  return { subject, text, html: wrapEmailBody(inner, `Login code: ${params.code}`) };
}

export function adminCreatedUserCredentialsEmail(params: {
  name?: string | null;
  email: string;
  temporaryPassword: string;
}) {
  const name = params.name?.trim() || "there";
  const base = siteBase();
  const subject = "Tradeict Earner — your account is ready";
  const text = `Hi ${name},

An administrator created a Tradeict Earner account for you.

Email (sign-in): ${params.email}
Temporary password: ${params.temporaryPassword}

Sign in at ${base}/login with your email and password. You will receive a one-time code by email to complete login.

Please change your password after first sign-in (use Forgot password on the login page if needed).

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">An administrator created a <strong>Tradeict Earner</strong> account for you.</p>
<p style="margin:0 0 6px;"><strong>Email (sign-in):</strong> ${escapeHtml(params.email)}</p>
<p style="margin:0 0 12px;"><strong>Temporary password:</strong> <code style="background:rgba(56,189,248,0.12);padding:4px 8px;border-radius:6px;font-size:14px;color:#7dd3fc;">${escapeHtml(params.temporaryPassword)}</code></p>
${ctaButton(`${base}/login`, "Sign in to Tradeict Earner")}
<p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Change your password after your first sign-in. You can use <strong>Forgot password</strong> on the login page if needed.</p>
`;
  return {
    subject,
    text,
    html: wrapEmailBody(inner, "Your account is ready — sign in"),
  };
}

export function forgotPasswordOtpEmail(params: { code: string }) {
  const subject = "Tradeict Earner — password reset code";
  const text = `Your password reset code is: ${params.code}

This code expires in 10 minutes. If you did not request a reset, ignore this email.

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Your <strong>Tradeict Earner</strong> password reset code is:</p>
<p style="margin:16px 0;font-size:30px;letter-spacing:6px;font-weight:800;color:#38bdf8;font-family:ui-monospace,monospace;">${escapeHtml(params.code)}</p>
<p style="margin:0;">This code expires in <strong>10 minutes</strong>. If you did not request a reset, ignore this email.</p>
`;
  return { subject, text, html: wrapEmailBody(inner, "Password reset code") };
}

// --- Admin / account lifecycle ---

export function approvalSuccessEmail(params: { name?: string | null }) {
  const name = params.name?.trim() || "there";
  const base = siteBase();
  const subject = "Tradeict Earner — your account is approved";
  const text = `Hi ${name},

Your Tradeict Earner account has been approved. You can sign in at ${base}/login using your email, password, and the verification code we send you each time.

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">Your <strong>Tradeict Earner</strong> account has been <strong style="color:#4ade80;">approved</strong>.</p>
${ctaButton(`${base}/login`, "Sign in")}
<p style="margin:14px 0 0;font-size:14px;color:#94a3b8;">Use your email and password. We will send a one-time verification code to complete login.</p>
`;
  return { subject, text, html: wrapEmailBody(inner, "Your account is approved") };
}

export function rejectionEmail(params: {
  name?: string | null;
  note?: string | null;
}) {
  const name = params.name?.trim() || "there";
  const note = params.note?.trim();
  const subject = "Tradeict Earner — registration update";
  const text = `Hi ${name},

We are unable to approve your Tradeict Earner registration at this time.${note ? `\n\nNote: ${note}` : ""}

If you believe this is a mistake, please contact support.

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">We are unable to approve your <strong>Tradeict Earner</strong> registration at this time.</p>
${note ? `<p style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);"><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
<p style="margin:0;">If you believe this is a mistake, please contact support.</p>
`;
  return { subject, text, html: wrapEmailBody(inner, "Registration update") };
}

export function profileChangeApprovedEmail(params: {
  name?: string | null;
  summaryLines: string[];
}) {
  const name = params.name?.trim() || "there";
  const base = siteBase();
  const linesHtml = params.summaryLines
    .map((l) => `<li style="margin:6px 0;">${escapeHtml(l)}</li>`)
    .join("");
  const subject = "Tradeict Earner — profile update approved";
  const text = `Hi ${name},

Your profile change request was approved. Updates applied:

${params.summaryLines.map((l) => `• ${l}`).join("\n")}

You can review your profile after signing in at ${base}/login

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">Your <strong>profile change request</strong> was <strong style="color:#4ade80;">approved</strong>. The following updates were applied:</p>
<ul style="margin:12px 0;padding-left:20px;color:#cbd5e1;">${linesHtml}</ul>
${ctaButton(`${base}/login`, "Sign in to review profile")}
`;
  return { subject, text, html: wrapEmailBody(inner, "Profile update approved") };
}

export function profileChangeRejectedEmail(params: {
  name?: string | null;
  note?: string | null;
}) {
  const name = params.name?.trim() || "there";
  const note = params.note?.trim();
  const base = siteBase();
  const subject = "Tradeict Earner — profile update not approved";
  const text = `Hi ${name},

Your profile change request was not approved.${note ? `\n\nNote from our team: ${note}` : ""}

Your account details were left unchanged.

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">Your <strong>profile change request</strong> was <strong>not approved</strong>.</p>
${note ? `<p style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);"><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
<p style="margin:0;">Your account details were left unchanged. You may submit a new request from your profile when needed.</p>
`;
  return { subject, text, html: wrapEmailBody(inner, "Profile update not approved") };
}

// --- Billing ---

export type BillingPaymentSuccessKind = "strategy_subscription" | "revenue_share";

export function billingPaymentSuccessEmail(
  params:
    | {
        kind: "strategy_subscription";
        name?: string | null;
        strategyName: string | null;
        amountInr: string;
        accessValidUntil: Date;
        isRenewal: boolean;
      }
    | {
        kind: "revenue_share";
        name?: string | null;
        strategyName: string | null;
        amountInr: string;
        weekStartIst: string;
        weekEndIst: string;
      },
) {
  const name = params.name?.trim() || "there";
  const base = siteBase();
  const amt = money2(Number.parseFloat(params.amountInr));
  const strat = params.strategyName?.trim() || "your strategy";

  if (params.kind === "strategy_subscription") {
    const label = params.isRenewal ? "Renewal confirmed" : "Subscription payment confirmed";
    const subject = `Tradeict Earner — ${label} — ${strat}`;
    const endStr = formatIstDateTime(params.accessValidUntil);
    const text = `Hi ${name},

Thank you. We received your payment of ₹${amt} for ${strat}.

${params.isRenewal ? "Your strategy access has been extended." : "Your strategy access is now active."}
Access valid until (IST): ${endStr}

Manage your strategies: ${base}/user/my-strategies

— Tradeict Earner
`;
    const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">Thank you. We received your payment of <strong style="color:#38bdf8;">₹${escapeHtml(amt)}</strong> for <strong>${escapeHtml(strat)}</strong>.</p>
<p style="margin:0 0 12px;">${params.isRenewal ? "Your strategy access has been <strong>extended</strong>." : "Your strategy access is now <strong>active</strong>."}</p>
<p style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);"><strong>Access valid until (IST):</strong> ${escapeHtml(endStr)}</p>
${ctaButton(`${base}/user/my-strategies`, "Open my strategies")}
`;
    return {
      subject,
      text,
      html: wrapEmailBody(inner, `${label} — ₹${amt}`),
    };
  }

  const weekLabel = `${params.weekStartIst} – ${params.weekEndIst}`;
  const subject = `Tradeict Earner — revenue share payment received (${weekLabel} IST)`;
  const text = `Hi ${name},

We received your revenue share payment of ₹${amt} for ${strat} (IST week ${weekLabel}).

Thank you for settling your weekly balance.

Funds: ${base}/user/funds?tab=platform

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">We received your <strong>revenue share</strong> payment of <strong style="color:#38bdf8;">₹${escapeHtml(amt)}</strong> for <strong>${escapeHtml(strat)}</strong>.</p>
<p style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);"><strong>IST week:</strong> ${escapeHtml(params.weekStartIst)} → ${escapeHtml(params.weekEndIst)}</p>
<p style="margin:0 0 12px;">Thank you for settling your weekly balance.</p>
${ctaButton(`${base}/user/funds?tab=platform`, "View funds & platform billing")}
`;
  return {
    subject,
    text,
    html: wrapEmailBody(inner, `Payment received — ₹${amt}`),
  };
}

export function billingRevenueDueReminderEmail(params: {
  strategyName: string;
  weekStart: string;
  weekEnd: string;
  outstandingInr: string;
  payUrl: string;
}) {
  const subject = `Tradeict Earner — revenue share due (week ${params.weekStart} IST)`;
  const text = `Hello,

You have an outstanding revenue-share balance for strategy "${params.strategyName}" for the IST week ${params.weekStart}–${params.weekEnd}.

Amount remaining: ₹${params.outstandingInr}.

Pay securely in your dashboard:
${params.payUrl}

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hello,</p>
<p style="margin:0 0 12px;">You have an outstanding <strong>revenue share</strong> balance for <strong>${escapeHtml(params.strategyName)}</strong> for the IST week <strong>${escapeHtml(params.weekStart)}</strong>–<strong>${escapeHtml(params.weekEnd)}</strong>.</p>
<p style="margin:0 0 12px;">Amount remaining: <strong style="color:#fbbf24;">₹${escapeHtml(params.outstandingInr)}</strong></p>
${ctaButton(params.payUrl, "Pay now — open funds")}
`;
  return {
    subject,
    text,
    html: wrapEmailBody(inner, `Revenue share due — ₹${params.outstandingInr}`),
  };
}

export function billingSubscriptionExpiryReminderEmail(params: {
  name?: string | null;
  strategyName: string;
  strategySlug: string;
  accessValidUntil: Date;
  daysLeft: number;
}) {
  const name = params.name?.trim() || "there";
  const base = siteBase();
  const renewUrl = `${base}/user/strategies/${encodeURIComponent(params.strategySlug)}/checkout`;
  const endStr = formatIstDateTime(params.accessValidUntil);
  const d = Math.max(0, Math.floor(params.daysLeft));
  const subject = `Tradeict Earner — strategy access ends in ${d} day${d === 1 ? "" : "s"}`;
  const text = `Hi ${name},

Your access to strategy "${params.strategyName}" will end soon.

Days left (approx.): ${d}
Access ends (IST): ${endStr}

Renew to keep uninterrupted access:
${renewUrl}

— Tradeict Earner
`;
  const inner = `
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px;">Your access to <strong>${escapeHtml(params.strategyName)}</strong> will end soon.</p>
<p style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.28);">
<strong style="color:#fbbf24;">Days left (approx.):</strong> ${d}<br/>
<strong>Access ends (IST):</strong> ${escapeHtml(endStr)}
</p>
${ctaButton(renewUrl, "Renew subscription")}
`;
  return {
    subject,
    text,
    html: wrapEmailBody(inner, `${d} day(s) left on ${params.strategyName}`),
  };
}
