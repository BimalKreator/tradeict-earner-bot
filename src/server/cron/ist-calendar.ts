/**
 * IST civil-calendar helpers for revenue jobs.
 *
 * We store `date` columns as plain YYYY-MM-DD labels in Asia/Kolkata (no DST).
 * For weekday / arithmetic, treat each Y-M-D as a UTC calendar date with the same
 * year/month/day so `Date.UTC(y, m-1, d)` matches the IST wall calendar.
 */

import { calendarDateIST } from "@/server/queries/user-dashboard";

export { calendarDateIST };

/** Add signed whole days to a YYYY-MM-DD string; returns YYYY-MM-DD. */
export function addCalendarDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** 0 = Sunday … 6 = Saturday (for the IST calendar date label). */
export function istWeekdaySun0(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Last instant (23:59:59.999) of an IST civil day, as a JS Date (absolute instant). */
export function istEndOfCalendarDayUtc(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

/**
 * Payment due anchor: week is Mon–Sun IST; week_end is Sunday’s date.
 * We set `due_at` to end of the Friday that is 5 calendar days after that Sunday.
 */
export function istDueFridayAfterWeekEndSunday(weekEndSundayYmd: string): Date {
  const fridayYmd = addCalendarDaysYmd(weekEndSundayYmd, 5);
  return istEndOfCalendarDayUtc(fridayYmd);
}
