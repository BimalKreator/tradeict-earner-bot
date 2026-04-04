/** Shared subscription extension math (strategy checkout webhooks). */

export const MS_PER_DAY = 86400000;

/** Defensive cap so malformed metadata cannot extend access by centuries. */
export const MAX_ACCESS_DAYS_PURCHASED = 366 * 15;

/**
 * Normalizes `access_days_purchased` from payment rows (default 30, min 1, capped).
 */
export function normalizeAccessDaysPurchased(
  raw: number | null | undefined,
): number {
  const d = raw ?? 30;
  if (!Number.isFinite(d) || d < 1) return 30;
  return Math.min(Math.floor(d), MAX_ACCESS_DAYS_PURCHASED);
}

/**
 * Stacked renewal: `anchor = max(now, currentEnd)` when a row exists; else from `now`.
 */
export function computeStackedAccessValidUntil(
  now: Date,
  currentAccessEnd: Date | null,
  accessDaysPurchased: number | null | undefined,
): Date {
  const days = normalizeAccessDaysPurchased(accessDaysPurchased);
  const extendMs = days * MS_PER_DAY;
  if (!currentAccessEnd) {
    return new Date(now.getTime() + extendMs);
  }
  const anchorMs = Math.max(now.getTime(), currentAccessEnd.getTime());
  return new Date(anchorMs + extendMs);
}
