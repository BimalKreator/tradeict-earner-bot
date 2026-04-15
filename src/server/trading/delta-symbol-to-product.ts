import { resolveProductId } from "@/server/exchange/delta-product-resolver";

/**
 * Maps strategy `symbol` strings to Delta India `product_id`.
 *
 * Resolution order:
 * 1. Bare numeric string or `product:123` alias.
 * 2. **Live catalog** — `GET /v2/products` (cached 24h by default).
 * 3. Optional legacy override: `DELTA_INDIA_SYMBOL_TO_PRODUCT_ID` JSON map.
 */
export async function resolveDeltaIndiaProductId(
  symbol: string,
): Promise<
  { ok: true; productId: number } | { ok: false; error: string }
> {
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

  const dyn = await resolveProductId(s);
  if (typeof dyn === "number" && dyn > 0) {
    return { ok: true, productId: dyn };
  }
  if (typeof dyn === "string" && /^\d+$/.test(dyn)) {
    const n = Number(dyn);
    if (Number.isFinite(n) && n > 0) return { ok: true, productId: n };
  }

  const raw = process.env.DELTA_INDIA_SYMBOL_TO_PRODUCT_ID?.trim();
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, number>;
      const key = Object.keys(map).find((k) => k.toUpperCase() === s.toUpperCase());
      if (key !== undefined) {
        const pid = Number(map[key]);
        if (Number.isFinite(pid) && pid > 0) {
          return { ok: true, productId: pid };
        }
        return { ok: false, error: `Invalid product_id for symbol "${s}" in env map.` };
      }
    } catch {
      return { ok: false, error: "DELTA_INDIA_SYMBOL_TO_PRODUCT_ID is not valid JSON." };
    }
  }

  return {
    ok: false,
    error: `Unknown Delta India symbol "${s}". Check the symbol on Delta India or set DELTA_INDIA_SYMBOL_TO_PRODUCT_ID as a temporary override.`,
  };
}
