export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
};

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!host || !user || pass === undefined || pass === "") {
    return null;
  }
  const port = Number(process.env.SMTP_PORT || "587");
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;
  return { host, port, secure, auth: { user, pass } };
}

export function getFromAddress(): string {
  return (
    process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || "noreply@localhost"
  );
}

export function getFromDisplayName(): string {
  return process.env.EMAIL_FROM_NAME?.trim() || "Tradeict Earner";
}
