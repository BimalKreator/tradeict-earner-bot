import { randomBytes } from "crypto";

/** Public correlation id for a strategy signal batch (idempotency / tracing). */
export function generateSignalCorrelationId(): string {
  return `sig_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

/**
 * Unique client order id we send to the exchange (and store as `internal_client_order_id`).
 * Delta India `client_order_id` max length 32 — keep this ≤ 32 characters.
 */
export function generateInternalClientOrderId(): string {
  return `TE-${randomBytes(14).toString("hex")}`;
}
