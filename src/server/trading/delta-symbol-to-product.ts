/**
 * Maps strategy `symbol` strings to Delta India `product_id`.
 *
 * Configure `DELTA_INDIA_SYMBOL_TO_PRODUCT_ID` as JSON, e.g. `{"BTCUSD":27,"ETHUSD":28}`.
 * You can also pass a bare numeric string (`"27"`) or `product:27` / `product_27`.
 */
export function resolveDeltaIndiaProductId(symbol: string):
  | { ok: true; productId: number }
  | { ok: false; error: string } {
  const s = symbol.trim();
  if (!s) return { ok: false, error: "empty_symbol" };

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0
      ? { ok: true, productId: n }
      : { ok: false, error: "invalid_numeric_product_id" };
  }

  const alias = s.match(/^product[_:-](\d+)$/i);
  if (alias) {
    const n = Number(alias[1]);
    return Number.isFinite(n) && n > 0
      ? { ok: true, productId: n }
      : { ok: false, error: "invalid_product_alias" };
  }

  const raw = process.env.DELTA_INDIA_SYMBOL_TO_PRODUCT_ID?.trim();
  if (!raw) {
    return {
      ok: false,
      error:
        "Set DELTA_INDIA_SYMBOL_TO_PRODUCT_ID (JSON map of symbol → product_id), or use a numeric product id as `symbol`.",
    };
  }

  let map: Record<string, number>;
  try {
    map = JSON.parse(raw) as Record<string, number>;
  } catch {
    return { ok: false, error: "DELTA_INDIA_SYMBOL_TO_PRODUCT_ID is not valid JSON." };
  }

  const key = Object.keys(map).find((k) => k.toUpperCase() === s.toUpperCase());
  if (key === undefined) {
    return {
      ok: false,
      error: `Unknown symbol "${s}" in DELTA_INDIA_SYMBOL_TO_PRODUCT_ID.`,
    };
  }

  const pid = Number(map[key]);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: `Invalid product_id for symbol "${s}".` };
  }

  return { ok: true, productId: pid };
}
