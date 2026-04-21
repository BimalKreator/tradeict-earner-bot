export type PlaceOrderInput = {
  internalClientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: string;
  limitPrice?: string | null;
  /** Delta `reduce_only` — required for reliable position closes. */
  reduceOnly?: boolean;
  /**
   * Isolated margin: applied via `POST /v2/products/{product_id}/orders/leverage` immediately
   * before placing the order (Delta does not rely on a default for every account/product).
   */
  leverage?: string | null;
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

export type ExchangeOpenPosition = {
  symbol: string;
  /** Signed contracts (long +, short -). */
  netQty: string;
  markPrice?: string | null;
  entryPrice?: string | null;
};

export type ExchangeOpenPositionsResult =
  | { ok: true; positions: ExchangeOpenPosition[]; raw?: Record<string, unknown> | null }
  | { ok: false; error: string; raw?: Record<string, unknown> | null };

export type PlaceReduceOnlyStopLossInput = {
  internalClientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  stopPrice: string;
};

export type AmendStopLossOrderInput = {
  existingExternalOrderId: string;
  replacementInternalClientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  newStopPrice: string;
};

export type AmendStopLossOrderResult =
  | { ok: true; externalOrderId: string; raw: Record<string, unknown>; cancelledExisting: boolean }
  | { ok: false; error: string; raw?: Record<string, unknown> };

export type CancelOrderByExternalIdResult =
  | { ok: true; cancelled: boolean; raw?: Record<string, unknown> }
  | { ok: false; error: string; raw?: Record<string, unknown> };

/**
 * Exchange-specific execution. Implementations must never log secrets.
 */
export interface ExchangeTradingAdapter {
  readonly providerId: string;

  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;

  /** Optional — cancel by venue order id (e.g. manual flatten / emergency cleanup). */
  cancelOrderByExternalId?(externalOrderId: string): Promise<CancelOrderByExternalIdResult>;

  /** Optional — used to reconcile `bot_orders` with the venue. */
  syncOrderStatus(externalOrderId: string): Promise<OrderSyncResult>;

  /** Optional — used for read-only position reconciliation snapshots. */
  fetchOpenPositions?(opts?: {
    /**
     * Optional symbol filter. When provided, implementations may issue one call per symbol/product.
     * Symbols should be venue symbols (e.g. BTCUSD).
     */
    symbols?: string[];
  }): Promise<ExchangeOpenPositionsResult>;

  /** Optional — place protective reduce-only stop-loss at the venue. */
  placeReduceOnlyStopLoss?(input: PlaceReduceOnlyStopLossInput): Promise<PlaceOrderResult>;

  /** Optional — strict in-place stop-loss amendment via cancel-and-replace flow. */
  amendStopLossOrder?(input: AmendStopLossOrderInput): Promise<AmendStopLossOrderResult>;
}
