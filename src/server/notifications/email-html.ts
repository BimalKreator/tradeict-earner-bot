/** Escape text nodes and attribute-like interpolations in HTML emails. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shared dark / blue “glass” shell. Inner content should be table-safe blocks (paragraphs, links).
 * Optional preheader hidden in inbox preview only.
 */
export function wrapEmailBody(innerHtml: string, previewText?: string): string {
  const pre = previewText
    ? `<div style="display:none;font-size:1px;color:#030712;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(previewText)}</div>`
    : "";
  const parts = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head><meta charset=\"utf-8\"/><meta name=\"color-scheme\" content=\"dark\"/><meta name=\"viewport\" content=\"width=device-width\"/></head>",
    '<body style="margin:0;background:#030712;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;">',
    pre,
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(165deg,#020617 0%,#0c1222 40%,#020617 100%);padding:28px 12px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" style="max-width:560px;border-radius:18px;border:1px solid rgba(56,189,248,0.28);background:rgba(15,23,42,0.82);box-shadow:0 16px 48px rgba(0,0,0,0.55);">',
    '<tr><td style="padding:28px 24px 24px;">',
    '<div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#38bdf8;margin-bottom:14px;font-weight:600;">Tradeict Earner</div>',
    innerHtml,
    '<p style="margin:28px 0 0;font-size:12px;color:#64748b;line-height:1.45;">You are receiving this because of activity on your Tradeict Earner account. If this was not you, you can ignore this message.</p>',
    "</td></tr></table>",
    "</td></tr></table>",
    "</body></html>",
  ];
  return parts.join("");
}
