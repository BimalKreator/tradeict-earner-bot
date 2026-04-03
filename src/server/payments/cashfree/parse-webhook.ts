export type WebhookFulfillmentInput = {
  orderId: string;
  paymentStatus: "SUCCESS" | "FAILED" | "USER_DROPPED" | "EXPIRED" | "UNKNOWN";
  externalPaymentId: string | null;
};

export type PaymentWebhookResult = {
  handled: boolean;
  skippedReason?: string;
  /** Caller runs `releaseRevenueBlock` after commit when set. */
  releaseRevenueBlockForUserId?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

export function extractCashfreeOrderId(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const data = asRecord(root.data);
  if (data) {
    const order = asRecord(data.order);
    if (order && typeof order.order_id === "string" && order.order_id.length > 0) {
      return order.order_id;
    }
    if (typeof data.order_id === "string" && data.order_id.length > 0) {
      return data.order_id;
    }
  }

  if (typeof root.order_id === "string" && root.order_id.length > 0) {
    return root.order_id;
  }

  return null;
}

function normalizePaymentStatus(raw: string | undefined): WebhookFulfillmentInput["paymentStatus"] {
  if (!raw) return "UNKNOWN";
  const u = raw.toUpperCase();
  if (u === "SUCCESS" || u === "SUCCESSFUL") return "SUCCESS";
  if (u === "FAILED" || u === "FAILURE") return "FAILED";
  if (u.includes("DROP") || u === "USER_DROPPED") return "USER_DROPPED";
  if (u === "EXPIRED") return "EXPIRED";
  return "UNKNOWN";
}

/**
 * Map Cashfree webhook JSON to fulfillment input using `type` + nested payment fields.
 */
export function parseCashfreeWebhookForFulfillment(
  body: unknown,
): WebhookFulfillmentInput | null {
  const orderId = extractCashfreeOrderId(body);
  if (!orderId) return null;

  const root = asRecord(body);
  const eventType = typeof root?.type === "string" ? root.type : "";

  const data = asRecord(root?.data);
  const payment = data ? asRecord(data.payment) : null;
  const rawPs =
    payment && typeof payment.payment_status === "string"
      ? payment.payment_status
      : undefined;
  const cfPaymentId =
    payment && typeof payment.cf_payment_id === "string"
      ? payment.cf_payment_id
      : null;

  let paymentStatus = normalizePaymentStatus(rawPs);

  if (eventType.includes("SUCCESS")) {
    paymentStatus = "SUCCESS";
  } else if (eventType.includes("FAILED") && !eventType.includes("USER")) {
    paymentStatus = "FAILED";
  } else if (eventType.includes("USER_DROPPED") || eventType.includes("DROPPED")) {
    paymentStatus = "USER_DROPPED";
  } else if (eventType.includes("EXPIRED")) {
    paymentStatus = "EXPIRED";
  }

  if (paymentStatus === "UNKNOWN" && rawPs) {
    paymentStatus = normalizePaymentStatus(rawPs);
  }

  return {
    orderId,
    paymentStatus,
    externalPaymentId: cfPaymentId,
  };
}
