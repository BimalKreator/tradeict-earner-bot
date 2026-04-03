import type {
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
    return {
      ok: true,
      status: externalOrderId.startsWith("mock-ord-") ? "filled" : "unknown",
      raw: { mock: true, externalOrderId },
    };
  }
}
