/** Run statuses an admin may force-pause from (single source of truth). */
export const ADMIN_FORCE_PAUSE_SOURCE_STATUSES = new Set([
  "active",
  "paused_by_user",
  "ready_to_activate",
  "inactive",
  "paused_exchange_off",
]);

/** Admin UI: show force-pause when the run is in one of these states. */
export function adminCanForcePauseRunStatus(runStatus: string | null): boolean {
  if (!runStatus) return false;
  return ADMIN_FORCE_PAUSE_SOURCE_STATUSES.has(runStatus);
}
