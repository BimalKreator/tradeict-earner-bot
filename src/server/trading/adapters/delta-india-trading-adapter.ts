import {
  deltaIndiaDefaultBaseUrl,
  signDeltaIndiaRequest,
} from "@/server/exchange/delta-india-sign";
import { resolveDeltaIndiaProductId } from "@/server/trading/delta-symbol-to-product";

import type {
  ExchangeTradingAdapter,
  OrderSyncResult,
  PlaceOrderInput,
  PlaceOrderResult,
} from "./exchange-adapter-types";

function coerceNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseDeltaOrderResultPayload(
  json: Record<string, unknown>,
): {
  externalOrderId: string;
  venueState: string | null;
  size: number;
  unfilledSize: number;
  fillPrice: string | null;
  filledQtyStr: string | null;
} | null {
  const result = json.result;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.id === undefined || r.id === null) return null;
  const externalOrderId = String(r.id);
  const venueState = typeof r.state === "string" ? r.state : null;
  const size = coerceNum(r.size) ?? 0;
  const unfilled = coerceNum(r.unfilled_size) ?? size;
  const avg = r.average_fill_price;
  let fillPrice: string | null = null;
  if (typeof avg === "string" && avg.trim() !== "") fillPrice = avg;
  else if (typeof avg === "number" && Number.isFinite(avg)) fillPrice = String(avg);
  const filled = Math.max(0, size - unfilled);
  const filledQtyStr = filled > 0 ? String(filled) : null;
  return {
    externalOrderId,
    venueState,
    size,
    unfilledSize: unfilled,
    fillPrice,
    filledQtyStr,
  };
}

function mapVenueToSyncStatus(
  venueState: string | null,
  size: number,
  unfilledSize: number,
): "open" | "filled" | "partial" | "cancelled" | "rejected" | "unknown" {
  if (venueState === "cancelled") return "cancelled";
  if (venueState === "closed") {
    if (size > 0 && unfilledSize <= 0) return "filled";
    if (size > 0 && unfilledSize > 0 && unfilledSize < size) return "partial";
    if (size > 0 && unfilledSize === size) return "rejected";
    return "unknown";
  }
  if (venueState === "open" || venueState === "pending") return "open";
  return "unknown";
}

function buildPlaceOrderJsonBody(
  productId: number,
  input: PlaceOrderInput,
): { body: string } | { error: string } {
  const size = Number(input.quantity);
  if (!Number.isFinite(size) || size === 0) {
    return { error: "Order size must be a non-zero number." };
  }

  const order_type =
    input.orderType === "market" ? "market_order" : "limit_order";

  if (order_type === "limit_order") {
    const lp = input.limitPrice?.trim();
    if (!lp) return { error: "limit_price is required for limit orders." };
  }

  const payload: Record<string, string | number> = {
    product_id: productId,
    size,
    side: input.side,
    order_type,
    client_order_id: input.internalClientOrderId,
  };

  if (order_type === "limit_order") {
    payload.limit_price = input.limitPrice!.trim();
  }

  return { body: JSON.stringify(payload) };
}

/**
 * Live Delta India adapter: `POST /v2/orders`, `GET /v2/orders/{id}`,
 * `GET /v2/orders/client_order_id/{client_oid}` for idempotent recovery.
 *
 * Requires `DELTA_TRADING_ENABLED=true`, valid API keys, and symbol→product mapping
 * (`DELTA_INDIA_SYMBOL_TO_PRODUCT_ID` or numeric `symbol`).
 */
export class DeltaIndiaTradingAdapter implements ExchangeTradingAdapter {
  readonly providerId = "delta_india";

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  private async signedFetch(
    method: string,
    path: string,
    queryString: string,
    body: string,
  ): Promise<{ ok: boolean; status: number; text: string; json: Record<string, unknown> }> {
    const base = deltaIndiaDefaultBaseUrl();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signDeltaIndiaRequest(
      this.apiSecret,
      method,
      timestamp,
      path,
      queryString,
      body,
    );

    const headers: Record<string, string> = {
      Accept: "application/json",
      "api-key": this.apiKey,
      timestamp,
      signature,
      "User-Agent": "TradeictEarner/1.0 (Node)",
    };
    if (method === "POST" || method === "PUT") {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${base}${path}${queryString}`, {
      method,
      headers,
      body: method === "POST" || method === "PUT" ? body : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-JSON */
    }
    return { ok: res.ok, status: res.status, text, json };
  }

  private async fetchOrderByClientOrderId(
    clientOrderId: string,
  ): Promise<PlaceOrderResult | null> {
    const path = `/v2/orders/client_order_id/${encodeURIComponent(clientOrderId)}`;
    const r = await this.signedFetch("GET", path, "", "");
    if (!r.ok || r.json.success !== true) return null;
    const parsed = parseDeltaOrderResultPayload(r.json);
    if (!parsed) return null;
    return {
      ok: true,
      externalOrderId: parsed.externalOrderId,
      externalClientOrderId: clientOrderId,
      raw: r.json,
    };
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const product = resolveDeltaIndiaProductId(input.symbol);
    if (!product.ok) {
      return { ok: false, error: product.error };
    }

    try {
      const recovered = await this.fetchOrderByClientOrderId(
        input.internalClientOrderId,
      );
      if (recovered?.ok) {
        return recovered;
      }

      const built = buildPlaceOrderJsonBody(product.productId, input);
      if ("error" in built) {
        return { ok: false, error: built.error };
      }

      const path = "/v2/orders";
      const r = await this.signedFetch("POST", path, "", built.body);

      if (!r.ok) {
        const errMsg =
          typeof r.json.error === "object" && r.json.error !== null
            ? JSON.stringify(r.json.error).slice(0, 1800)
            : r.text.slice(0, 1800);
        return {
          ok: false,
          error: `Delta order HTTP ${r.status}: ${errMsg}`,
          raw: r.json,
        };
      }

      if (r.json.success !== true) {
        return {
          ok: false,
          error: `Delta order rejected: ${r.text.slice(0, 1800)}`,
          raw: r.json,
        };
      }

      const parsed = parseDeltaOrderResultPayload(r.json);
      if (!parsed) {
        return {
          ok: false,
          error: "Delta response missing order result.",
          raw: r.json,
        };
      }

      return {
        ok: true,
        externalOrderId: parsed.externalOrderId,
        externalClientOrderId: input.internalClientOrderId,
        raw: r.json,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Delta placeOrder error: ${msg}` };
    }
  }

  async syncOrderStatus(externalOrderId: string): Promise<OrderSyncResult> {
    const path = `/v2/orders/${encodeURIComponent(externalOrderId)}`;
    try {
      const r = await this.signedFetch("GET", path, "", "");
      if (!r.ok) {
        return {
          ok: false,
          error: `Delta order sync HTTP ${r.status}: ${r.text.slice(0, 200)}`,
        };
      }
      if (r.json.success !== true) {
        return {
          ok: false,
          error: `Delta order sync unsuccessful: ${r.text.slice(0, 200)}`,
        };
      }
      const parsed = parseDeltaOrderResultPayload(r.json);
      if (!parsed) {
        return { ok: true, status: "unknown", raw: r.json };
      }
      const status = mapVenueToSyncStatus(
        parsed.venueState,
        parsed.size,
        parsed.unfilledSize,
      );
      return {
        ok: true,
        status,
        raw: r.json,
        venueOrderState: parsed.venueState,
        fillPrice: parsed.fillPrice,
        filledQty: parsed.filledQtyStr,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}
