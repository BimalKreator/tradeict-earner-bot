const site = "https://tradeictearner.online";

export function registrationReceivedEmail(params: { name?: string | null }) {
  const name = params.name?.trim() || "there";
  const subject = "Tradeict Earner — registration received";
  const text = `Hi ${name},

We have received your registration for Tradeict Earner. Your account is pending admin approval.

You will receive another email when your account has been approved and you can complete sign-in (password + email OTP).

If you did not register, please ignore this message.

— Tradeict Earner
${site}
`;
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>We have received your registration for <strong>Tradeict Earner</strong>. Your account is <strong>pending approval</strong> by our team.</p>
<p>You will receive another email when your account is approved and you can sign in using your password and a one-time code sent to this address.</p>
<p>If you did not register, you can ignore this email.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner<br/><a href="${site}">${site}</a></p>
`;
  return { subject, text, html };
}

export function approvalSuccessEmail(params: { name?: string | null }) {
  const name = params.name?.trim() || "there";
  const subject = "Tradeict Earner — your account is approved";
  const text = `Hi ${name},

Your Tradeict Earner account has been approved. You can sign in at ${site}/login using your email, password, and the verification code we send you each time.

— Tradeict Earner
`;
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>Your <strong>Tradeict Earner</strong> account has been <strong>approved</strong>.</p>
<p>You can <a href="${site}/login">sign in</a> with your email and password. We will email you a one-time verification code to complete login.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner</p>
`;
  return { subject, text, html };
}

export function rejectionEmail(params: {
  name?: string | null;
  note?: string | null;
}) {
  const name = params.name?.trim() || "there";
  const subject = "Tradeict Earner — registration update";
  const note = params.note?.trim();
  const text = `Hi ${name},

We are unable to approve your Tradeict Earner registration at this time.${note ? `\n\nNote: ${note}` : ""}

If you believe this is a mistake, please contact support.

— Tradeict Earner
`;
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>We are unable to approve your <strong>Tradeict Earner</strong> registration at this time.</p>
${note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
<p>If you believe this is a mistake, please contact support.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner</p>
`;
  return { subject, text, html };
}

export function loginOtpEmail(params: { code: string }) {
  const subject = "Tradeict Earner — your login code";
  const text = `Your Tradeict Earner login code is: ${params.code}

This code expires in 10 minutes. If you did not try to sign in, ignore this email.

— Tradeict Earner
`;
  const html = `
<p>Your <strong>Tradeict Earner</strong> login code is:</p>
<p style="font-size:28px;letter-spacing:4px;font-weight:700;color:#0ea5e9;">${escapeHtml(params.code)}</p>
<p>This code expires in <strong>10 minutes</strong>. If you did not try to sign in, you can ignore this email.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner</p>
`;
  return { subject, text, html };
}

export function adminCreatedUserCredentialsEmail(params: {
  name?: string | null;
  email: string;
  temporaryPassword: string;
}) {
  const name = params.name?.trim() || "there";
  const subject = "Tradeict Earner — your account is ready";
  const text = `Hi ${name},

An administrator created a Tradeict Earner account for you.

Email (sign-in): ${params.email}
Temporary password: ${params.temporaryPassword}

Sign in at ${site}/login with your email and password. You will receive a one-time code by email to complete login.

Please change your password after first sign-in (use Forgot password on the login page if needed).

— Tradeict Earner
${site}
`;
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>An administrator created a <strong>Tradeict Earner</strong> account for you.</p>
<p><strong>Email (sign-in):</strong> ${escapeHtml(params.email)}</p>
<p><strong>Temporary password:</strong> <code style="font-size:14px;">${escapeHtml(params.temporaryPassword)}</code></p>
<p><a href="${site}/login">Sign in</a> with your email and password. We will send a one-time code to this address to complete login.</p>
<p style="color:#64748b;font-size:13px;">Change your password after your first sign-in. You can use <strong>Forgot password</strong> on the login page if needed.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner<br/><a href="${site}">${site}</a></p>
`;
  return { subject, text, html };
}

export function forgotPasswordOtpEmail(params: { code: string }) {
  const subject = "Tradeict Earner — password reset code";
  const text = `Your password reset code is: ${params.code}

This code expires in 10 minutes. If you did not request a reset, ignore this email.

— Tradeict Earner
`;
  const html = `
<p>Your <strong>Tradeict Earner</strong> password reset code is:</p>
<p style="font-size:28px;letter-spacing:4px;font-weight:700;color:#0ea5e9;">${escapeHtml(params.code)}</p>
<p>This code expires in <strong>10 minutes</strong>. If you did not request a reset, ignore this email.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner</p>
`;
  return { subject, text, html };
}

export function profileChangeApprovedEmail(params: {
  name?: string | null;
  summaryLines: string[];
}) {
  const name = params.name?.trim() || "there";
  const lines = params.summaryLines.map((l) => `• ${l}`).join("\n");
  const linesHtml = params.summaryLines
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join("");
  const subject = "Tradeict Earner — profile update approved";
  const text = `Hi ${name},

Your profile change request was approved. Updates applied:

${lines}

You can review your profile after signing in at ${site}/login

— Tradeict Earner
`;
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>Your <strong>profile change request</strong> was <strong>approved</strong>. The following updates were applied:</p>
<ul style="padding-left:20px;">${linesHtml}</ul>
<p><a href="${site}/login">Sign in</a> to review your profile.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner</p>
`;
  return { subject, text, html };
}

export function profileChangeRejectedEmail(params: {
  name?: string | null;
  note?: string | null;
}) {
  const name = params.name?.trim() || "there";
  const note = params.note?.trim();
  const subject = "Tradeict Earner — profile update not approved";
  const text = `Hi ${name},

Your profile change request was not approved.${note ? `\n\nNote from our team: ${note}` : ""}

Your account details were left unchanged. You can submit a new request from your profile if needed.

— Tradeict Earner
${site}
`;
  const html = `
<p>Hi ${escapeHtml(name)},</p>
<p>Your <strong>profile change request</strong> was <strong>not approved</strong>.</p>
${note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
<p>Your account details were left unchanged. You may submit a new request from your profile if needed.</p>
<p style="margin-top:24px;color:#64748b;font-size:12px;">— Tradeict Earner<br/><a href="${site}">${site}</a></p>
`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
