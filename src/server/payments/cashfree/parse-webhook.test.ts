import { describe, expect, it } from "vitest";

import {
  extractCashfreeOrderId,
  parseCashfreeWebhookForFulfillment,
} from "./parse-webhook";

describe("extractCashfreeOrderId", () => {
  it("reads nested data.order.order_id and trims", () => {
    expect(
      extractCashfreeOrderId({
        data: { order: { order_id: "  abc-123  " } },
      }),
    ).toBe("abc-123");
  });

  it("reads data.order_id", () => {
    expect(
      extractCashfreeOrderId({ data: { order_id: "550e8400-e29b-41d4-a716-446655440000" } }),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("reads root order_id", () => {
    expect(extractCashfreeOrderId({ order_id: "root-id" })).toBe("root-id");
  });

  it("returns null for empty / missing", () => {
    expect(extractCashfreeOrderId(null)).toBeNull();
    expect(extractCashfreeOrderId({})).toBeNull();
    expect(extractCashfreeOrderId({ data: { order: { order_id: "   " } } })).toBeNull();
  });
});

describe("parseCashfreeWebhookForFulfillment", () => {
  it("maps SUCCESS payment_status", () => {
    const body = {
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: "pay-1" },
        payment: { payment_status: "SUCCESS", cf_payment_id: "cf_1" },
      },
    };
    expect(parseCashfreeWebhookForFulfillment(body)).toEqual({
      orderId: "pay-1",
      paymentStatus: "SUCCESS",
      externalPaymentId: "cf_1",
    });
  });

  it("treats FAILED as FAILED", () => {
    const body = {
      data: {
        order: { order_id: "pay-2" },
        payment: { payment_status: "FAILED" },
      },
    };
    expect(parseCashfreeWebhookForFulfillment(body)?.paymentStatus).toBe("FAILED");
  });

  it("returns null without order id", () => {
    expect(parseCashfreeWebhookForFulfillment({ data: {} })).toBeNull();
  });
});
