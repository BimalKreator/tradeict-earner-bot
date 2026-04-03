const IST = "Asia/Kolkata";

function calendarYmdInTz(
  d: Date,
  timeZone: string,
): { y: number; m: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    m: Number(map.month),
    day: Number(map.day),
  };
}

function utcDayIndex(y: number, m: number, day: number): number {
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

/**
 * Calendar-day difference in Asia/Kolkata between `now` and the calendar day
 * that contains `accessValidUntil` (both boundaries use the same instant’s IST date).
 * Returns 0 when both fall on the same IST calendar day; never negative.
 */
export function remainingAccessCalendarDaysIST(
  accessValidUntil: Date,
  now: Date = new Date(),
): number {
  const end = calendarYmdInTz(accessValidUntil, IST);
  const start = calendarYmdInTz(now, IST);
  const diff =
    utcDayIndex(end.y, end.m, end.day) - utcDayIndex(start.y, start.m, start.day);
  return Math.max(0, diff);
}

export function formatDateTimeIST(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: IST,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Date-only label in Asia/Kolkata (e.g. renewal “new expiry” copy). */
export function formatDateMediumIST(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
