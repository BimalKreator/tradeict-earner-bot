import { normalizeDeltaIndiaApiSymbol } from "./delta-india-symbol";
import { deltaIndiaDefaultBaseUrl, signDeltaIndiaRequest } from "./delta-india-sign";

export type DeltaIndiaSignedFetchResult = {
  ok: boolean;
  status: number;
  text: string;
  json: Record<string, unknown>;
};

async function signedGet(params: {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  path: string;
  queryString: string;
}): Promise<DeltaIndiaSignedFetchResult> {
  const base = (params.baseUrl ?? deltaIndiaDefaultBaseUrl()).replace(/\/$/, "");
  const method = "GET";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signDeltaIndiaRequest(
    params.apiSecret,
    method,
    timestamp,
    params.path,
    params.queryString,
    "",
  );
  const url = `${base}${params.path}${params.queryString}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "api-key": params.apiKey,
        timestamp,
        signature,
        "User-Agent": "TradeictEarner/1.0 (Node)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      text: msg,
      json: {},
    };
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, text, json };
}

function coerceNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type PrimaryPositionSnapshot =
  | {
      open: true;
      size: number;
      entryPrice: number;
      side: "long" | "short";
      markPrice: number | null;
    }
  | { open: false };

/**
 * `GET /v2/positions?product_id=` — real-time position for one product.
 * @see Delta Exchange REST docs — Positions
 */
export async function fetchDeltaIndiaPosition(params: {
  apiKey: string;
  apiSecret: string;
  productId: number;
  baseUrl?: string;
}): Promise<
  | { ok: true; position: PrimaryPositionSnapshot }
  | { ok: false; error: string }
> {
  const path = "/v2/positions";
  const queryString = `?product_id=${encodeURIComponent(String(params.productId))}`;
  const r = await signedGet({
    apiKey: params.apiKey,
    apiSecret: params.apiSecret,
    baseUrl: params.baseUrl,
    path,
    queryString,
  });
  if (!r.ok) {
    return {
      ok: false,
      error: `positions_http_${r.status}: ${r.text.slice(0, 240)}`,
    };
  }
  if (r.json.success !== true) {
    return {
      ok: false,
      error: `positions_not_success: ${r.text.slice(0, 240)}`,
    };
  }
  const result = r.json.result;
  if (!result || typeof result !== "object") {
    return { ok: true, position: { open: false } };
  }
  const o = result as Record<string, unknown>;
  const size = coerceNum(o.size) ?? 0;
  if (!Number.isFinite(size) || Math.abs(size) < 1e-12) {
    return { ok: true, position: { open: false } };
  }
  const entry = coerceNum(o.entry_price) ?? coerceNum(o.average_entry_price);
  if (entry == null || entry <= 0) {
    return { ok: false, error: "position_missing_entry_price" };
  }
  const mark =
    coerceNum(o.mark_price) ??
    coerceNum(o.markPrice) ??
    coerceNum((o as { mp?: unknown }).mp);
  return {
    ok: true,
    position: {
      open: true,
      size: Math.abs(size),
      entryPrice: entry,
      side: size > 0 ? "long" : "short",
      markPrice: mark != null && mark > 0 ? mark : null,
    },
  };
}

/**
 * Public `GET /v2/tickers/{symbol}` — mark price when position payload lacks it.
 */
export async function fetchDeltaIndiaTickerMarkPrice(params: {
  symbol: string;
  baseUrl?: string;
}): Promise<number | null> {
  const base = (params.baseUrl ?? deltaIndiaDefaultBaseUrl()).replace(/\/$/, "");
  const sym = encodeURIComponent(normalizeDeltaIndiaApiSymbol(params.symbol));
  const url = `${base}/v2/tickers/${sym}`;
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
    const n = coerceNum((result as Record<string, unknown>).mark_price);
    return n != null && n > 0 ? n : null;
  } catch {
    return null;
  }
}
