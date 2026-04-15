export type PlaceOrderInput = {
  internalClientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: string;
  limitPrice?: string | null;
  /** Delta `reduce_only` — required for reliable position closes. */
  reduceOnly?: boolean;
};

export type PlaceOrderSuccess = {
  ok: true;
  externalOrderId: string;
  externalClientOrderId?: string | null;
  raw: Record<string, unknown>;
};

export type PlaceOrderFailure = {
  ok: false;
  error: string;
  raw?: Record<string, unknown>;
};

export type PlaceOrderResult = PlaceOrderSuccess | PlaceOrderFailure;

export type OrderSyncSuccess = {
  ok: true;
  status: "open" | "filled" | "partial" | "cancelled" | "rejected" | "unknown";
  raw: Record<string, unknown>;
  /** Delta `state` when available. */
  venueOrderState?: string | null;
  fillPrice?: string | null;
  filledQty?: string | null;
};

export type OrderSyncResult =
  | OrderSyncSuccess
  | { ok: false; error: string };

/**
 * Exchange-specific execution. Implementations must never log secrets.
 */
export interface ExchangeTradingAdapter {
  readonly providerId: string;

  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;

  /** Optional — used to reconcile `bot_orders` with the venue. */
  syncOrderStatus(externalOrderId: string): Promise<OrderSyncResult>;
}
