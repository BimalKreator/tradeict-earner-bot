import { createHmac, timingSafeEqual } from "crypto";

/**
 * Cashfree PG webhook verification (per Cashfree docs):
 * HMAC-SHA256 using the secret key over the string `timestamp + rawBody`,
 * then compare to `x-webhook-signature` (base64-encoded digest).
 *
 * @see https://www.cashfree.com/docs/payments/online/webhooks
 */
export function verifyCashfreeWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secretKey: string;
}): boolean {
  const { rawBody, signatureHeader, timestampHeader, secretKey } = params;
  if (!signatureHeader || !timestampHeader || !secretKey) {
    return false;
  }

  const signedPayload = timestampHeader + rawBody;
  const expectedMac = createHmac("sha256", secretKey)
    .update(signedPayload, "utf8")
    .digest();

  let received: Buffer;
  try {
    received = Buffer.from(signatureHeader.trim(), "base64");
  } catch {
    return false;
  }

  if (received.length !== expectedMac.length) {
    return false;
  }

  return timingSafeEqual(received, expectedMac);
}
