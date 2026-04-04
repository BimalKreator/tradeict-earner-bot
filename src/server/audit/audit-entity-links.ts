/**
 * Best-effort deep links from audit rows to admin screens.
 * Uses `metadata` when `entity_id` alone is not enough (e.g. runs → subscription).
 */
export function resolveAuditEntityLink(
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const m = metadata ?? {};
  const str = (k: string) =>
    typeof m[k] === "string" && m[k] ? (m[k] as string) : null;

  const subscriptionId = str("subscription_id");
  const targetUserId = str("target_user_id") ?? str("userId");

  switch (entityType) {
    case "user":
      return entityId ? `/admin/users/${entityId}` : null;
    case "strategy":
      return entityId ? `/admin/strategies/${entityId}` : null;
    case "user_strategy_subscription":
      return entityId ? `/admin/user-strategies/${entityId}` : null;
    case "user_strategy_run":
      return subscriptionId ? `/admin/user-strategies/${subscriptionId}` : null;
    case "weekly_revenue_share_ledger":
    case "payment":
      return targetUserId
        ? `/admin/revenue/users/${targetUserId}`
        : "/admin/revenue";
    case "user_strategy_pricing_override":
      return targetUserId ? `/admin/users/${targetUserId}/pricing` : null;
    case "profile_change_request":
      return targetUserId ? `/admin/users/${targetUserId}` : "/admin/profile-requests";
    case "terms_and_conditions":
      return entityId ? `/admin/terms/${entityId}/edit` : "/admin/terms";
    default:
      return null;
  }
}
