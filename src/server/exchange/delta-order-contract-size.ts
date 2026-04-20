/**
 * Delta India derivatives: REST `size` is an integer contract (lot) count, not fractional coin.
 * @see https://docs.delta.exchange/ — CreateOrderRequest.size (integer).
 */
export function normalizeDeltaOrderContractSize(
  quantityStr: string,
): { ok: true; size: number } | { ok: false; error: string } {
  const raw = Number(String(quantityStr ?? "").trim());
  if (!Number.isFinite(raw) || raw === 0) {
    return { ok: false, error: "Order size must be a non-zero number." };
  }
  const sizeInt = Math.floor(Math.abs(raw));
  if (sizeInt < 1) {
    return {
      ok: false,
      error:
        "Order size rounds to zero contracts — use at least 1 contract (integer lots only).",
    };
  }
  return { ok: true, size: sizeInt };
}
