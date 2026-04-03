const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

/** Parses Drizzle/pg numeric strings safely for display. */
export function formatInrAmount(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return inrFmt.format(0);
  return inrFmt.format(n);
}

export function formatIntCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}
