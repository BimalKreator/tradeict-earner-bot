/**
 * Pure activation gates for user strategy runs (mirrors `userStrategyRun` server action).
 */

export const ACTIVATE_FROM_STATUSES = new Set([
  "ready_to_activate",
  "paused_by_user",
  "paused_exchange_off",
  "paused_insufficient_funds",
  "inactive",
]);

export function subscriptionActiveEntitled(
  status: string,
  accessValidUntil: Date,
  now: Date,
): boolean {
  return status === "active" && accessValidUntil.getTime() > now.getTime();
}

export function activationRevenueDueBlockMessage(runStatus: string): string | null {
  if (runStatus === "blocked_revenue_due") {
    return "Resolve revenue due before activating this strategy.";
  }
  if (runStatus === "paused_revenue_due") {
    return "This strategy cannot be activated while revenue is overdue.";
  }
  if (runStatus === "paused_admin") {
    return "This run was paused by support. Contact us to continue.";
  }
  return null;
}

export function canActivateFromRunStatus(runStatus: string): boolean {
  return ACTIVATE_FROM_STATUSES.has(runStatus);
}
