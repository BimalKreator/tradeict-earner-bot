import { normalizeDeltaIndiaApiSymbol } from "@/server/exchange/delta-india-symbol";
import {
  fetchDeltaIndiaProductIdDirect,
  resolveProductId,
} from "@/server/exchange/delta-product-resolver";

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
  const raw = symbol.trim();
  if (!raw) return { ok: false, error: "empty_symbol" };

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0
      ? { ok: true, productId: n }
      : { ok: false, error: "invalid_numeric_product_id" };
  }

  const alias = raw.match(/^product[_:-](\d+)$/i);
  if (alias) {
    const n = Number(alias[1]);
    return Number.isFinite(n) && n > 0
      ? { ok: true, productId: n }
      : { ok: false, error: "invalid_product_alias" };
  }

  const s = normalizeDeltaIndiaApiSymbol(raw);
  if (!s) return { ok: false, error: "empty_symbol" };

  const dyn = await resolveProductId(s);
  if (typeof dyn === "number" && dyn > 0) {
    return { ok: true, productId: dyn };
  }
  if (typeof dyn === "string" && /^\d+$/.test(dyn)) {
    const n = Number(dyn);
    if (Number.isFinite(n) && n > 0) return { ok: true, productId: n };
  }

  const directId = await fetchDeltaIndiaProductIdDirect(s);
  if (directId != null && directId > 0) {
    return { ok: true, productId: directId };
  }

  const envMapJson = process.env.DELTA_INDIA_SYMBOL_TO_PRODUCT_ID?.trim();
  if (envMapJson) {
    try {
      const map = JSON.parse(envMapJson) as Record<string, number>;
      const key = Object.keys(map).find(
        (k) => normalizeDeltaIndiaApiSymbol(k).toUpperCase() === s.toUpperCase(),
      );
      if (key !== undefined) {
        const pid = Number(map[key]);
        if (Number.isFinite(pid) && pid > 0) {
          return { ok: true, productId: pid };
        }
        return { ok: false, error: `Invalid product_id for symbol "${symbol.trim()}" in env map.` };
      }
    } catch {
      return { ok: false, error: "DELTA_INDIA_SYMBOL_TO_PRODUCT_ID is not valid JSON." };
    }
  }

  return {
    ok: false,
    error: `Unknown Delta India symbol "${raw}" (API: "${s}"). Check the symbol on Delta India or set DELTA_INDIA_SYMBOL_TO_PRODUCT_ID as a temporary override.`,
  };
}
