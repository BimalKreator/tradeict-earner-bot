import { randomBytes } from "crypto";

/** Public correlation id for a strategy signal batch (idempotency / tracing). */
export function generateSignalCorrelationId(): string {
  return `sig_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

/** Unique client order id we send to the exchange (and store as `internal_client_order_id`). */
export function generateInternalClientOrderId(): string {
  return `TE-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}
