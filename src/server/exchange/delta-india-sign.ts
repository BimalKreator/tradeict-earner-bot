import { createHmac } from "crypto";

/** Base URL for Delta Exchange India REST (no trailing slash). */
export function deltaIndiaDefaultBaseUrl(): string {
  return (
    process.env.DELTA_INDIA_API_BASE_URL?.trim() ||
    "https://api.india.delta.exchange"
  ).replace(/\/$/, "");
}

/**
 * HMAC-SHA256 hex signature for Delta India v2 REST.
 * Prehash: `method + timestamp + path + queryString + body` (body is exact JSON string for POST).
 */
export function signDeltaIndiaRequest(
  apiSecret: string,
  method: string,
  timestamp: string,
  path: string,
  queryString: string,
  body: string,
): string {
  const prehash = method + timestamp + path + queryString + body;
  return createHmac("sha256", apiSecret).update(prehash).digest("hex");
}
