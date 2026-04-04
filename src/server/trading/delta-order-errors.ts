/**
 * Heuristic matching for Delta India order API failures when margin or balance is inadequate.
 * Delta payloads vary; we match common substrings and numeric error codes when present in JSON.
 */
export function isInsufficientBalanceOrMarginDeltaError(
  errorMessage: string,
  raw?: Record<string, unknown> | null,
): boolean {
  const msg = errorMessage.toLowerCase();
  const needles = [
    "insufficient",
    "margin",
    "balance",
    "not enough",
    "undercollateral",
    "collateral",
    "funds",
    "wallet",
  ];
  if (needles.some((n) => msg.includes(n))) return true;

  if (!raw) return false;
  const blob = JSON.stringify(raw).toLowerCase();
  if (needles.some((n) => blob.includes(n))) return true;

  const code =
    typeof raw.code === "string" || typeof raw.code === "number"
      ? String(raw.code).toLowerCase()
      : "";
  if (code.includes("margin") || code.includes("balance")) return true;

  const err = raw.error;
  if (err && typeof err === "object") {
    const es = JSON.stringify(err).toLowerCase();
    if (needles.some((n) => es.includes(n))) return true;
  }

  return false;
}
