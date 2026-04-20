import {
  deltaIndiaDefaultBaseUrl,
  signDeltaIndiaRequest,
} from "@/server/exchange/delta-india-sign";
import type {
  DeltaWalletBalanceError,
  DeltaWalletBalanceSnapshot,
  DeltaWalletMovement,
  DeltaWalletTransactionsError,
  DeltaWalletTransactionsSnapshot,
} from "@/server/exchange/delta-india-wallet-types";
import { normalizeDeltaOrderContractSize } from "@/server/exchange/delta-order-contract-size";
import { fetchDeltaIndiaProductLeverageBounds } from "@/server/exchange/delta-product-resolver";
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

/** Delta may return `success` as boolean or (legacy) string. */
function deltaJsonSuccess(json: Record<string, unknown>): boolean {
  return json.success === true || json.success === "true";
}

/** Wallet rows live under `result` or `data.result`. */
function walletBalanceResultRows(json: Record<string, unknown>): unknown[] {
  const top = json.result;
  if (Array.isArray(top)) return top;
  const data = json.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>).result;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

/** Meta may be top-level or under `data.meta`. */
function walletBalanceMeta(json: Record<string, unknown>): Record<string, unknown> | null {
  const meta = json.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  const data = json.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const dm = (data as Record<string, unknown>).meta;
    if (dm && typeof dm === "object" && !Array.isArray(dm)) {
      return dm as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Portfolio-level total from `meta` (Delta India returns USD for wallet display).
 */
function readNetEquityFromMeta(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const keys = [
    "net_equity",
    "total_net_equity",
    "portfolio_net_equity",
  ];
  for (const k of keys) {
    const n = coerceNum(meta[k]);
    if (n !== null) return String(n);
  }
  return null;
}

function walletAssetSymbol(o: Record<string, unknown>): string {
  return typeof o.asset_symbol === "string"
    ? o.asset_symbol
    : String(o.asset_symbol ?? "");
}

/** Legacy fiat INR wallet row (fallback only). */
function isInrLikeWalletAsset(sym: string): boolean {
  const s = sym.trim().toUpperCase();
  if (s === "INR" || s === "INRF") return true;
  if (s === "INR_FIAT" || s === "FIAT_INR") return true;
  return false;
}

/** USD-stable / USD-denominated wallet rows (balances in USD). */
function isUsdStableWalletAsset(sym: string): boolean {
  const s = sym.trim().toUpperCase();
  return s === "USDT" || s === "USD" || s === "USDC" || s === "BUSD";
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

function parseEligibleLeverage(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const floored = Math.floor(n);
  return floored >= 1 ? floored : null;
}

function isDeltaUnsupportedLeverageError(errorText: string): boolean {
  const s = errorText.toLowerCase();
  return s.includes("\"code\":\"unsupported\"") || s.includes("unsupported");
}

function buildPlaceOrderJsonBody(
  productId: number,
  input: PlaceOrderInput,
): { body: string } | { error: string } {
  const sizeNorm = normalizeDeltaOrderContractSize(String(input.quantity));
  if (!sizeNorm.ok) {
    return { error: sizeNorm.error };
  }

  const order_type =
    input.orderType === "market" ? "market_order" : "limit_order";

  if (order_type === "limit_order") {
    const lp = input.limitPrice?.trim();
    if (!lp) return { error: "limit_price is required for limit orders." };
  }

  const payload: Record<string, string | number> = {
    product_id: productId,
    size: sizeNorm.size,
    side: input.side,
    order_type,
    client_order_id: input.internalClientOrderId,
  };

  if (input.reduceOnly) {
    payload.reduce_only = "true";
  }

  if (order_type === "limit_order") {
    payload.limit_price = input.limitPrice!.trim();
  }

  return { body: JSON.stringify(payload) };
}

/**
 * Live Delta India adapter: `POST /v2/orders`, `GET /v2/orders/{id}`,
 * `GET /v2/orders/client_order_id/{client_oid}` for idempotent recovery.
 *
 * Requires `DELTA_TRADING_ENABLED=true`, valid API keys, and a resolvable symbol
 * (live `GET /v2/products` catalog, optional `DELTA_INDIA_SYMBOL_TO_PRODUCT_ID`, or numeric `symbol`).
 */
export class DeltaIndiaTradingAdapter implements ExchangeTradingAdapter {
  readonly providerId = "delta_india";

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  /**
   * Delta isolated margin: set per-product order leverage before submitting the order.
   * @see https://docs.delta.exchange/ — `POST /products/{product_id}/orders/leverage`
   */
  private async setProductOrderLeverage(
    productId: number,
    leverage: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const path = `/v2/products/${productId}/orders/leverage`;
    const body = JSON.stringify({ leverage });
    const r = await this.signedFetch("POST", path, "", body);
    if (!r.ok) {
      const errMsg =
        typeof r.json.error === "object" && r.json.error !== null
          ? JSON.stringify(r.json.error).slice(0, 800)
          : r.text.slice(0, 800);
      return { ok: false, error: `Delta set leverage HTTP ${r.status}: ${errMsg}` };
    }
    if (!deltaJsonSuccess(r.json)) {
      return {
        ok: false,
        error: `Delta set leverage rejected: ${r.text.slice(0, 800)}`,
      };
    }
    return { ok: true };
  }

  protected async signedFetch(
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
    const product = await resolveDeltaIndiaProductId(input.symbol);
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

      const lev = parseEligibleLeverage(input.leverage ?? null);
      if (lev != null) {
        let levRes = await this.setProductOrderLeverage(product.productId, lev);
        if (!levRes.ok && isDeltaUnsupportedLeverageError(levRes.error)) {
          const bounds = await fetchDeltaIndiaProductLeverageBounds(input.symbol);
          const maxLev = bounds.maxLeverage;
          const fallbackLev =
            maxLev != null ? Math.max(1, Math.min(Math.floor(maxLev), lev)) : null;
          if (fallbackLev != null && fallbackLev !== lev) {
            const fallbackRes = await this.setProductOrderLeverage(product.productId, fallbackLev);
            if (fallbackRes.ok) {
              console.warn(
                `[DeltaIndiaTradingAdapter] leverage fallback applied symbol=${input.symbol} requested=${lev} fallback=${fallbackLev}`,
              );
              levRes = { ok: true };
            } else {
              return {
                ok: false,
                error:
                  `Delta leverage unsupported for requested=${lev}; fallback=${fallbackLev} failed: ${fallbackRes.error}`,
              };
            }
          } else {
            return {
              ok: false,
              error:
                `Delta leverage unsupported for requested=${lev}; no fallback leverage metadata found for ${input.symbol}`,
            };
          }
        }
        if (!levRes.ok) {
          return { ok: false, error: levRes.error };
        }
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

  /**
   * `GET /v2/wallet/balances` — portfolio equity and per-asset balances (read-only).
   */
  async fetchWalletBalances(): Promise<
    DeltaWalletBalanceSnapshot | DeltaWalletBalanceError
  > {
    const path = "/v2/wallet/balances";
    try {
      const r = await this.signedFetch("GET", path, "", "");

      if (!r.ok) {
        return {
          ok: false,
          error: `Delta wallet HTTP ${r.status}: ${r.text.slice(0, 200)}`,
          httpStatus: r.status,
        };
      }
      if (!deltaJsonSuccess(r.json)) {
        return {
          ok: false,
          error: `Delta wallet response not successful: ${r.text.slice(0, 300)}`,
          httpStatus: r.status,
        };
      }

      const metaObj = walletBalanceMeta(r.json);
      const netEquity = readNetEquityFromMeta(metaObj);

      const resultArr = walletBalanceResultRows(r.json);
      const rows: DeltaWalletBalanceSnapshot["assetRows"] = [];
      for (const item of resultArr) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const sym = walletAssetSymbol(o);
        const bal = o.balance != null ? String(o.balance) : null;
        const av =
          o.available_balance != null ? String(o.available_balance) : null;
        rows.push({ assetSymbol: sym, balance: bal, availableBalance: av });
      }

      /** Sum available margin in USD across USD-stable wallet rows only. */
      let marginUsd = 0;
      let hasMarginUsd = false;
      for (const row of rows) {
        const avn = row.availableBalance != null ? Number(row.availableBalance) : NaN;
        if (!Number.isFinite(avn)) continue;
        if (isUsdStableWalletAsset(row.assetSymbol)) {
          marginUsd += avn;
          hasMarginUsd = true;
        }
      }

      let liveBalanceDisplay: string | null = netEquity;

      if (!liveBalanceDisplay) {
        let stableBalSum = 0;
        let anyStable = false;
        for (const row of rows) {
          if (!isUsdStableWalletAsset(row.assetSymbol)) continue;
          const b = row.balance != null ? Number(row.balance) : NaN;
          if (Number.isFinite(b)) {
            stableBalSum += b;
            anyStable = true;
          }
        }
        if (anyStable) liveBalanceDisplay = String(stableBalSum);
      }

      if (!liveBalanceDisplay) {
        const inrRow = rows.find((row) => isInrLikeWalletAsset(row.assetSymbol));
        const inrBal = inrRow?.balance != null ? Number(inrRow.balance) : NaN;
        if (Number.isFinite(inrBal)) {
          liveBalanceDisplay = String(inrBal);
        }
      }

      if (!liveBalanceDisplay) {
        console.warn(
          "[DeltaIndiaTradingAdapter] Could not derive wallet display: missing meta.net_equity and no USD-stable or INR wallet row.",
        );
      }

      return {
        ok: true,
        netEquity,
        availableMarginTotal: hasMarginUsd ? String(marginUsd) : null,
        liveBalanceDisplay,
        assetRows: rows,
        rawMeta: metaObj,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  /**
   * `GET /v2/wallet/transactions` — latest wallet movements (deposits, withdrawals, etc.).
   */
  async fetchWalletTransactions(opts?: {
    pageSize?: number;
  }): Promise<
    DeltaWalletTransactionsSnapshot | DeltaWalletTransactionsError
  > {
    const pageSize = Math.min(Math.max(opts?.pageSize ?? 10, 1), 50);
    const path = "/v2/wallet/transactions";
    const queryString = `?page_size=${pageSize}`;
    try {
      const r = await this.signedFetch("GET", path, queryString, "");
      if (!r.ok) {
        return {
          ok: false,
          error: `Delta transactions HTTP ${r.status}: ${r.text.slice(0, 200)}`,
          httpStatus: r.status,
        };
      }
      if (r.json.success !== true) {
        return {
          ok: false,
          error: "Delta transactions response not successful.",
          httpStatus: r.status,
        };
      }
      const result = r.json.result;
      const movements: DeltaWalletMovement[] = [];
      if (Array.isArray(result)) {
        for (const item of result) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const id = o.id != null ? String(o.id) : "";
          const amount = o.amount != null ? String(o.amount) : "0";
          const bal = o.balance != null ? String(o.balance) : null;
          const tt =
            typeof o.transaction_type === "string"
              ? o.transaction_type
              : String(o.transaction_type ?? "");
          const asym =
            typeof o.asset_symbol === "string"
              ? o.asset_symbol
              : String(o.asset_symbol ?? "");
          const ca = o.created_at != null ? String(o.created_at) : null;
          if (id) movements.push({
            id,
            amount,
            balanceAfter: bal,
            transactionType: tt,
            assetSymbol: asym,
            createdAt: ca,
          });
        }
      }
      return { ok: true, movements };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
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
