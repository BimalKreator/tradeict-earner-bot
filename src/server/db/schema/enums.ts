import { pgEnum } from "drizzle-orm/pg-core";

/** End-user onboarding / lifecycle gate for login and trading. */
export const userApprovalStatusEnum = pgEnum("user_approval_status", [
  "pending_approval",
  "approved",
  "rejected",
  "paused",
  "archived",
]);

export const adminRoleEnum = pgEnum("admin_role", ["super_admin", "staff"]);

export const otpPurposeEnum = pgEnum("otp_purpose", [
  "login",
  "verify_email",
  "password_reset",
]);

export const exchangeProviderEnum = pgEnum("exchange_provider", [
  "delta_india",
]);

/** Whether the user has turned the connection on or an admin/system disabled it. */
export const exchangeConnectionStatusEnum = pgEnum(
  "exchange_connection_status",
  ["active", "disabled_user", "disabled_admin", "error"],
);

export const exchangeConnectionTestStatusEnum = pgEnum(
  "exchange_connection_test_status",
  [
    "unknown",
    "success",
    "failure",
    "invalid_credentials",
    "permission_denied",
  ],
);

export const strategyStatusEnum = pgEnum("strategy_status", [
  "active",
  "paused",
  "hidden",
  "archived",
]);

/** Catalog visibility for end users (Phase 9+). Distinct from operational `status`. */
export const strategyVisibilityEnum = pgEnum("strategy_visibility", [
  "public",
  "hidden",
]);

export const strategyRiskLabelEnum = pgEnum("strategy_risk_label", [
  "low",
  "medium",
  "high",
]);

/**
 * Subscription billing window (30-day stacks on access_valid_until).
 * Purchased but not yet activated stays in purchased_pending_activation.
 */
export const userStrategySubscriptionStatusEnum = pgEnum(
  "user_strategy_subscription_status",
  ["purchased_pending_activation", "active", "expired", "cancelled"],
);

/**
 * Runtime bot execution state (1:1 with subscription via `user_strategy_runs`).
 * Legacy `paused` migrated to `paused_by_user` in migration 0008.
 */
export const userStrategyRunStatusEnum = pgEnum("user_strategy_run_status", [
  "inactive",
  "active",
  "paused",
  "paused_revenue_due",
  "paused_exchange_off",
  "paused_admin",
  "expired",
  "blocked_revenue_due",
  "ready_to_activate",
  "paused_by_user",
]);

export const paymentProviderEnum = pgEnum("payment_provider", ["cashfree"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "success",
  "failed",
  "refunded",
  "created",
  "expired",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "issued",
  "paid",
  "void",
]);

export const revenueLedgerStatusEnum = pgEnum("revenue_ledger_status", [
  "unpaid",
  "partial",
  "paid",
  "waived",
]);

export const profileChangeRequestStatusEnum = pgEnum(
  "profile_change_request_status",
  ["pending", "approved", "rejected"],
);

export const reminderTypeEnum = pgEnum("reminder_type", [
  "payment_due",
  "revenue_due",
  "onboarding",
  "custom",
]);

export const reminderChannelEnum = pgEnum("reminder_channel", ["email"]);

export const reminderStatusEnum = pgEnum("reminder_status", [
  "pending",
  "sent",
  "cancelled",
  "failed",
]);

export const emailLogStatusEnum = pgEnum("email_log_status", [
  "queued",
  "sent",
  "failed",
]);

/** User-facing notification audit trail (email today; more channels later). */
export const notificationLogStatusEnum = pgEnum("notification_log_status", [
  "sent",
  "failed",
]);

export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "admin",
  "user",
  "system",
]);

export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);

/** Exchange bot order lifecycle (internal TE-* client order id + optional external id). */
export const botOrderStatusEnum = pgEnum("bot_order_status", [
  "draft",
  "queued",
  "submitting",
  "open",
  "filled",
  "partial_fill",
  "cancelled",
  "rejected",
  "failed",
]);

/** Postgres-backed execution queue for strategy signals (no Redis required). */
export const tradingJobStatusEnum = pgEnum("trading_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead",
]);

/** Origin of an exchange order row (bot vs manual mirror in future). */
export const botTradeSourceEnum = pgEnum("bot_trade_source", ["bot", "manual"]);
