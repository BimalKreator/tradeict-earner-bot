import { NextResponse } from "next/server";

import { addCalendarDaysYmd, calendarDateIST } from "@/server/cron/ist-calendar";
import { cronUnauthorized, verifyCronRequest } from "@/server/cron/verify-cron-request";
import { runDailyPnlSnapshotForIstDate } from "@/server/jobs/revenue-share-engine";
import { enforceRevenueDueBlocks } from "@/server/revenue/revenue-due-gate";

export const dynamic = "force-dynamic";

/**
 * Daily IST PnL snapshot (intended schedule: 18:30 UTC ≈ 00:00 IST next calendar day).
 *
 * Default target = **yesterday** in Asia/Kolkata so the first moments of “today” IST
 * capture the full previous IST date’s closed bot_orders.
 *
 * Backfill: `?date=YYYY-MM-DD` (still requires `CRON_SECRET`).
 *
 * After a successful snapshot, runs {@link enforceRevenueDueBlocks} so overdue
 * weekly ledgers move `active` runs to `blocked_revenue_due` (Phase 22).
 */
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return cronUnauthorized();

  const url = new URL(request.url);
  const override = url.searchParams.get("date");
  const istToday = calendarDateIST();
  const target =
    override && /^\d{4}-\d{2}-\d{2}$/.test(override)
      ? override
      : addCalendarDaysYmd(istToday, -1);

  try {
    const daily = await runDailyPnlSnapshotForIstDate(target);
    const revenueBlocks = daily.ok
      ? await enforceRevenueDueBlocks()
      : { blockedRunIds: [] as string[] };
    return NextResponse.json({ ok: daily.ok, daily, revenueBlocks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const POST = GET;
