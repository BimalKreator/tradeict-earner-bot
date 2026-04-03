import { getAppBaseUrl, isCashfreeProduction } from "./app-url";

export type CashfreeCreateOrderInput = {
  orderId: string;
  /** Rupee amount as decimal string e.g. "499.00" */
  amountInr: string;
  customerId: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
};

export type CashfreeCreateOrderResult =
  | { ok: true; paymentSessionId: string }
  | { ok: false; message: string; status?: number };

const API_VERSION = "2023-08-01";

function pgHost(): string {
  return isCashfreeProduction()
    ? "https://api.cashfree.com"
    : "https://sandbox.cashfree.com";
}

/**
 * Create a Cashfree order and return `payment_session_id` for Drop / JS checkout.
 */
export async function createCashfreePgOrder(
  input: CashfreeCreateOrderInput,
): Promise<CashfreeCreateOrderResult> {
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      message: "Cashfree API credentials are not configured (CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET).",
    };
  }

  const notifyUrl = `${getAppBaseUrl()}/api/webhooks/cashfree`;
  const amountNum = Number.parseFloat(input.amountInr);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { ok: false, message: "Invalid order amount." };
  }

  const res = await fetch(`${pgHost()}/pg/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify({
      order_id: input.orderId,
      order_amount: amountNum,
      order_currency: "INR",
      customer_details: {
        customer_id: input.customerId,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: notifyUrl,
      },
    }),
  });

  const text = await res.text();
  let json: { payment_session_id?: string; message?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    /* non-json */
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message:
        json.message ??
        text.slice(0, 200) ??
        `Cashfree order failed (${res.status})`,
    };
  }

  const paymentSessionId = json.payment_session_id;
  if (!paymentSessionId || typeof paymentSessionId !== "string") {
    return {
      ok: false,
      message: "Cashfree response missing payment_session_id.",
    };
  }

  return { ok: true, paymentSessionId };
}
