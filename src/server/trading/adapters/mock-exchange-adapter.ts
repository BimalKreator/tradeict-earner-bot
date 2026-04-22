import type {
  CancelOrdersByPriceMatchInput,
  CancelAllConditionalOrdersForSymbolResult,
  CancelOrderByExternalIdResult,
  ExchangeOpenPositionsResult,
  ExchangeTradingAdapter,
  OrderSyncResult,
  PlaceOrderInput,
  PlaceOrderResult,
} from "./exchange-adapter-types";

/**
 * Deterministic mock venue for integration tests and local development.
 * Does not perform network I/O.
 */
export class MockExchangeAdapter implements ExchangeTradingAdapter {
  readonly providerId = "mock";

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const externalOrderId = `mock-ord-${input.internalClientOrderId}`;
    return {
      ok: true,
      externalOrderId,
      externalClientOrderId: input.internalClientOrderId,
      raw: {
        mock: true,
        symbol: input.symbol,
        side: input.side,
        order_type: input.orderType,
        quantity: input.quantity,
      },
    };
  }

  async syncOrderStatus(externalOrderId: string): Promise<OrderSyncResult> {
    if (externalOrderId.startsWith("mock-ord-")) {
      return {
        ok: true,
        status: "filled",
        venueOrderState: "closed",
        fillPrice: "1",
        filledQty: "1",
        raw: { mock: true, externalOrderId },
      };
    }
    return {
      ok: true,
      status: "unknown",
      raw: { mock: true, externalOrderId },
    };
  }

  async cancelOrderByExternalId(_externalOrderId: string): Promise<CancelOrderByExternalIdResult> {
    return { ok: true, cancelled: true, raw: { mock: true } };
  }

  async cancelAllConditionalOrdersForSymbol(
    _symbol: string,
  ): Promise<CancelAllConditionalOrdersForSymbolResult> {
    return { ok: true, cancelledCount: 0, attemptedCount: 0, raw: { mock: true } };
  }

  async cancelOrdersByPriceMatch(
    _input: CancelOrdersByPriceMatchInput,
  ): Promise<CancelAllConditionalOrdersForSymbolResult> {
    return { ok: true, cancelledCount: 0, attemptedCount: 0, raw: { mock: true } };
  }

  async fetchOpenPositions(): Promise<ExchangeOpenPositionsResult> {
    return { ok: true, positions: [], raw: { mock: true } };
  }
}
