const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Platform billing (Cashfree, revenue ledgers, subscriptions) — amounts stored in INR columns. */
export function formatInrAmount(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return inrFmt.format(0);
  return inrFmt.format(n);
}

/**
 * Delta wallet, bot PnL, capital, and other trading metrics — values use `*_inr` DB columns
 * but are treated as USD notionally for display (per product rules).
 */
export function formatUsdAmount(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return usdFmt.format(0);
  return usdFmt.format(n);
}

export function formatIntCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}
