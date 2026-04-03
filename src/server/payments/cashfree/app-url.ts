/**
 * Absolute origin for return / webhook URLs (no trailing slash).
 */
export function getAppBaseUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    return `https://${vercel.replace(/\/$/, "")}`;
  }
  return "http://localhost:3000";
}

export function isCashfreeProduction(): boolean {
  return process.env.CASHFREE_ENV?.trim().toLowerCase() === "production";
}
