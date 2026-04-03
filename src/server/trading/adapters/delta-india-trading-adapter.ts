import { createHmac } from "crypto";

import type {
  ExchangeTradingAdapter,
  OrderSyncResult,
  PlaceOrderInput,
  PlaceOrderResult,
} from "./exchange-adapter-types";

function baseUrl(): string {
  return (
    process.env.DELTA_INDIA_API_BASE_URL?.trim() ||
    "https://api.india.delta.exchange"
  ).replace(/\/$/, "");
}

function sign(
  apiSecret: string,
  method: string,
  timestamp: string,
  path: string,
  query: string,
  body: string,
): string {
  const prehash = method + timestamp + path + query + body;
  return createHmac("sha256", apiSecret).update(prehash).digest("hex");
}

/**
 * Live Delta India adapter skeleton.
 *
 * Product/symbol routing (`symbol` → `product_id`) is venue-specific and not yet
 * wired; keep `DELTA_TRADING_ENABLED` off in production until mapping + order
 * payloads are validated against real accounts.
 */
export class DeltaIndiaTradingAdapter implements ExchangeTradingAdapter {
  readonly providerId = "delta_india";

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async placeOrder(_input: PlaceOrderInput): Promise<PlaceOrderResult> {
    void _input;
    return {
      ok: false,
      error:
        "Delta India order placement is not enabled: configure symbol→product_id mapping and set DELTA_TRADING_ENABLED=true after validation.",
    };
  }

  async syncOrderStatus(externalOrderId: string): Promise<OrderSyncResult> {
    const path = `/v2/orders/${encodeURIComponent(externalOrderId)}`;
    const method = "GET";
    const queryString = "";
    const body = "";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(
      this.apiSecret,
      method,
      timestamp,
      path,
      queryString,
      body,
    );

    try {
      const res = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "api-key": this.apiKey,
          timestamp,
          signature,
          "User-Agent": "TradeictEarner/1.0 (Node)",
        },
        cache: "no-store",
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        return {
          ok: false,
          error: `Delta order sync HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      return { ok: true, status: "unknown", raw: json };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}
