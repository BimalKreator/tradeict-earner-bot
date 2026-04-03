import { NextResponse } from "next/server";

import {
  addCalendarDaysYmd,
  calendarDateIST,
  istWeekdaySun0,
} from "@/server/cron/ist-calendar";
import { cronUnauthorized, verifyCronRequest } from "@/server/cron/verify-cron-request";
import { runWeeklyRevenueShareForIstWeek } from "@/server/jobs/revenue-share-engine";

export const dynamic = "force-dynamic";

/**
 * Weekly revenue share close (intended schedule: 18:35 UTC ≈ 00:05 IST).
 *
 * Runs **after** the daily snapshot route so Sunday’s last orders are in
 * `daily_pnl_snapshots` before we sum Mon–Sun IST.
 *
 * Default behavior on **Monday IST** only: previous week = `[today-7, today-1]` inclusive.
 * Other days return `{ skipped: true }` unless `week_start` + `week_end` are provided for ops backfill.
 */
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return cronUnauthorized();

  const url = new URL(request.url);
  const ws = url.searchParams.get("week_start");
  const we = url.searchParams.get("week_end");

  try {
    if (
      ws &&
      we &&
      /^\d{4}-\d{2}-\d{2}$/.test(ws) &&
      /^\d{4}-\d{2}-\d{2}$/.test(we)
    ) {
      const weekly = await runWeeklyRevenueShareForIstWeek(ws, we);
      return NextResponse.json({ ok: weekly.ok, weekly, manualRange: true });
    }

    const istToday = calendarDateIST();
    if (istWeekdaySun0(istToday) !== 1) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Not Monday IST — pass week_start & week_end to backfill.",
        istToday,
      });
    }

    const weekEndIst = addCalendarDaysYmd(istToday, -1);
    const weekStartIst = addCalendarDaysYmd(istToday, -7);
    const weekly = await runWeeklyRevenueShareForIstWeek(
      weekStartIst,
      weekEndIst,
    );
    return NextResponse.json({ ok: weekly.ok, weekly, istToday });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const POST = GET;
