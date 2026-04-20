import { deltaIndiaDefaultBaseUrl } from "./delta-india-sign";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type ProductCache = {
  map: Map<string, number>;
  expiresAt: number;
};

let cache: ProductCache | null = null;
/** In-flight catalog fetch so concurrent callers share one HTTP round-trip. */
let inflightFetch: Promise<Map<string, number>> | null = null;

function cacheTtlMs(): number {
  const raw = process.env.DELTA_INDIA_PRODUCTS_CACHE_TTL_MS?.trim();
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 60_000 ? n : DEFAULT_TTL_MS;
}

async function fetchAllProductsPages(): Promise<Map<string, number>> {
  const base = deltaIndiaDefaultBaseUrl().replace(/\/$/, "");
  const map = new Map<string, number>();
  let after = "";

  for (let guard = 0; guard < 200; guard++) {
    const qs = new URLSearchParams();
    qs.set("page_size", "100");
    if (after) qs.set("after", after);

    const url = `${base}/v2/products?${qs.toString()}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`products_invalid_json_http_${res.status}`);
    }

    if (!res.ok || json.success !== true) {
      throw new Error(`products_http_${res.status}: ${text.slice(0, 240)}`);
    }

    const result = json.result;
    if (!Array.isArray(result)) {
      break;
    }

    for (const item of result) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const sym = typeof o.symbol === "string" ? o.symbol.trim() : "";
      const idRaw = o.id;
      const id =
        typeof idRaw === "number"
          ? idRaw
          : typeof idRaw === "string"
            ? Number(idRaw)
            : NaN;
      if (sym && Number.isFinite(id) && id > 0) {
        map.set(sym.toUpperCase(), id);
      }
    }

    const meta = json.meta;
    const nextAfter =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>).after
        : null;

    if (result.length === 0) break;
    if (nextAfter == null || nextAfter === "" || typeof nextAfter !== "string") {
      break;
    }

    after = nextAfter;
  }

  return map;
}

/** `GET /v2/products/{symbol}` → `result` object, or null. */
async function fetchDeltaIndiaProductResultRecord(
  symbol: string,
): Promise<Record<string, unknown> | null> {
  const s = symbol.trim();
  if (!s) return null;
  const base = deltaIndiaDefaultBaseUrl().replace(/\/$/, "");
  const url = `${base}/v2/products/${encodeURIComponent(s.toUpperCase())}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!res.ok || json.success !== true) return null;
    const result = json.result;
    if (!result || typeof result !== "object") return null;
    return result as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Single-product lookup when the paginated catalog map misses or catalog fetch failed.
 * `GET /v2/products/{symbol}` returns `{ result: { id, symbol, ... } }`.
 */
export async function fetchDeltaIndiaProductIdDirect(symbol: string): Promise<number | null> {
  const result = await fetchDeltaIndiaProductResultRecord(symbol);
  if (!result) return null;
  const idRaw = result.id;
  const id =
    typeof idRaw === "number"
      ? idRaw
      : typeof idRaw === "string"
        ? Number(idRaw)
        : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * USD notional per one contract from the product record (`contract_value` in API docs).
 * Used with {@link contractsFromCollateralLeverageAndContractValue} when sizing from collateral.
 */
export async function fetchDeltaIndiaProductContractValue(
  symbol: string,
): Promise<number | null> {
  const result = await fetchDeltaIndiaProductResultRecord(symbol);
  if (!result) return null;
  const cvRaw = result.contract_value;
  const cv =
    typeof cvRaw === "number"
      ? cvRaw
      : typeof cvRaw === "string"
        ? Number(String(cvRaw).trim())
        : NaN;
  return Number.isFinite(cv) && cv > 0 ? cv : null;
}

/**
 * Fetches `GET /v2/products` (Delta India public REST) and caches symbol → id for {@link cacheTtlMs}.
 *
 * @see https://docs.delta.exchange/ — Products list + cursor pagination (`meta.after`).
 */
export async function fetchAndCacheProducts(
  force = false,
): Promise<Map<string, number>> {
  const now = Date.now();
  if (!force && cache != null && now < cache.expiresAt) {
    return cache.map;
  }

  if (force) {
    const map = await fetchAllProductsPages();
    cache = { map, expiresAt: Date.now() + cacheTtlMs() };
    return map;
  }

  return await (inflightFetch ??= (async () => {
    try {
      const map = await fetchAllProductsPages();
      cache = { map, expiresAt: Date.now() + cacheTtlMs() };
      return map;
    } finally {
      inflightFetch = null;
    }
  })());
}

/**
 * Resolves a trading symbol to a Delta `product_id`, or returns the original string
 * when the catalog does not contain it (keeps mock / numeric-symbol paths working).
 */
export async function resolveProductId(symbol: string): Promise<string | number> {
  const s = symbol.trim();
  if (!s) return symbol;

  try {
    const map = await fetchAndCacheProducts();
    const id = map.get(s.toUpperCase());
    if (id != null) return id;
  } catch {
    /* catalog fetch failed — caller may still use env map or numeric symbol */
  }

  return symbol;
}
