/**
 * Canonical vocabulary for `audit_logs.action` and `audit_logs.entity_type`.
 * Keep in sync with {@link logAuditEvent} callers; extend when adding features.
 */
export const AUDIT_ACTIONS = [
  // Users
  "user.approved",
  "user.rejected",
  "user.paused",
  "user.archived",
  "user.created_by_admin",
  "user.profile_updated",
  "user.internal_notes_updated",
  "user.password_changed",
  // Strategies
  "strategy.created",
  "strategy.updated",
  "strategy.visibility_changed",
  "strategy.status_changed",
  // Profile requests
  "profile_change_request.approved",
  "profile_change_request.rejected",
  // Billing
  "billing.fee_waiver_applied",
  "billing.payment_reminder_sent",
  "billing.ledger_admin_notes_updated",
  "billing.payment_admin_notes_updated",
  "billing.bulk_payment_reminder",
  // Pricing overrides
  "admin.pricing_override_created",
  "admin.pricing_override_updated",
  "admin.pricing_override_deleted",
  // User strategy / runs (admin)
  "admin.run_force_paused",
  "admin.run_resumed",
  "admin.subscription_extended",
  // User strategy run (end-user self-service)
  "strategy_run.settings_updated",
  // System / jobs
  "revenue_share_auto_block",
  "resumed_after_payment",
  // Terms
  "terms.draft_created",
  "terms.updated",
  "terms.published",
  "terms.archived",
  "terms.duplicated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  "user",
  "strategy",
  "profile_change_request",
  "weekly_revenue_share_ledger",
  "payment",
  "user_strategy_pricing_override",
  "user_strategy_run",
  "user_strategy_subscription",
  "terms_and_conditions",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export function isKnownAuditAction(s: string): s is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(s);
}

export function isKnownAuditEntityType(s: string): s is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(s);
}
