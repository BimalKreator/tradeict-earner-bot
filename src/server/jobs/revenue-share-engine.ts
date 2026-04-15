/**
 * Phase 21 — Revenue share engine (IST calendar).
 *
 * Daily job: aggregate realized PnL from terminal bot_orders into `daily_pnl_snapshots`
 * for one IST **snapshot** date (typically “yesterday” when the cron fires just after IST midnight).
 *
 * Weekly job (Mondays IST): sum `realized_pnl_inr` from daily snapshots for the **previous**
 * Mon–Sun IST window, apply effective revenue share % **frozen at end of that Sunday**,
 * and insert `weekly_revenue_share_ledgers` (idempotent per subscription × week).
 *
 * **Virtual / paper trading** (`virtual_strategy_runs`, `virtual_bot_orders`) is intentionally
 * excluded: this engine only reads `bot_orders` and `daily_pnl_snapshots` tied to real
 * subscriptions — no invoices for simulated balances.
 *
 * IST boundaries: every filter uses `timezone('Asia/Kolkata', ts)::date` so an order
 * finalized at 23:59 IST Sunday lands on Sunday’s IST date and therefore inside the
 * week that ends that Sunday — not Monday’s week.
 */

import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  botOrders,
  botPositions,
  dailyPnlSnapshots,
  strategies,
  userStrategyPricingOverrides,
  userStrategySubscriptions,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

import {
  istDueFridayAfterWeekEndSunday,
  istEndOfCalendarDayUtc,
} from "@/server/cron/ist-calendar";
import {
  toMoneyString,
  weeklyAmountDue,
} from "@/server/jobs/revenue-share-math";

const TERMINAL_BOT_STATUSES = ["filled", "partial_fill"] as const;

function assertIstYmd(label: string, s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`${label}: invalid IST date (expected YYYY-MM-DD)`);
  }
  return s;
}

async function sumUnrealizedBySubscription(
  subscriptionIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!db || subscriptionIds.length === 0) return map;
  const rows = await db
    .select({
      subscriptionId: botPositions.subscriptionId,
      v: sql<string>`coalesce(sum(cast(${botPositions.unrealizedPnlInr} as numeric)), 0)::text`,
    })
    .from(botPositions)
    .where(inArray(botPositions.subscriptionId, subscriptionIds))
    .groupBy(botPositions.subscriptionId);
  for (const r of rows) {
    map.set(r.subscriptionId, Number(r.v));
  }
  return map;
}

/**
 * Effective % at `evaluatedAt`: latest override row covering the instant, else strategy default.
 */
async function effectiveRevenueSharePercent(
  userId: string,
  strategyId: string,
  evaluatedAt: Date,
): Promise<string> {
  if (!db) return "0.00";
  const [ov] = await db
    .select({
      o: userStrategyPricingOverrides.revenueSharePercentOverride,
    })
    .from(userStrategyPricingOverrides)
    .where(
      and(
        eq(userStrategyPricingOverrides.userId, userId),
        eq(userStrategyPricingOverrides.strategyId, strategyId),
        eq(userStrategyPricingOverrides.isActive, true),
        lte(userStrategyPricingOverrides.effectiveFrom, evaluatedAt),
        or(
          isNull(userStrategyPricingOverrides.effectiveUntil),
          gt(userStrategyPricingOverrides.effectiveUntil, evaluatedAt),
        ),
      ),
    )
    .orderBy(desc(userStrategyPricingOverrides.effectiveFrom))
    .limit(1);

  const [s] = await db
    .select({ d: strategies.defaultRevenueSharePercent })
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  const raw = ov?.o ?? s?.d;
  const n = Number(raw);
  return Number.isFinite(n) ? toMoneyString(n) : "0.00";
}

export type DailyPnlJobResult = {
  ok: boolean;
  targetIstDate: string;
  upsertedRows: number;
  message?: string;
};

/**
 * Snapshot **targetIstDate** (YYYY-MM-DD): sum realized PnL from bot_orders whose
 * settlement timestamp falls on that IST date. Unrealized is the **current** book
 * on `bot_positions` at run time (job runs just after midnight; good enough for v1).
 *
 * Paper fills in `virtual_bot_orders` are never included.
 */
export async function runDailyPnlSnapshotForIstDate(
  targetIstDate: string,
): Promise<DailyPnlJobResult> {
  const day = assertIstYmd("targetIstDate", targetIstDate);
  if (!db) {
    return {
      ok: false,
      targetIstDate: day,
      upsertedRows: 0,
      message: "Database not configured.",
    };
  }

  const rows = await db
    .select({
      subscriptionId: botOrders.subscriptionId,
      userId: botOrders.userId,
      realized: sql<string>`coalesce(sum(cast(${botOrders.realizedPnlInr} as numeric)), 0)::text`,
    })
    .from(botOrders)
    .where(
      and(
        inArray(botOrders.status, [...TERMINAL_BOT_STATUSES]),
        sql`(timezone('Asia/Kolkata', coalesce(${botOrders.lastSyncedAt}, ${botOrders.updatedAt})))::date = ${day}::date`,
      ),
    )
    .groupBy(botOrders.subscriptionId, botOrders.userId);

  const unreal = await sumUnrealizedBySubscription(rows.map((r) => r.subscriptionId));

  let upserted = 0;
  for (const r of rows) {
    const realizedN = Number(r.realized);
    const u = unreal.get(r.subscriptionId) ?? 0;
    const total = (Number.isFinite(realizedN) ? realizedN : 0) + u;
    await db
      .insert(dailyPnlSnapshots)
      .values({
        userId: r.userId,
        subscriptionId: r.subscriptionId,
        snapshotDateIst: day,
        realizedPnlInr: toMoneyString(Number.isFinite(realizedN) ? realizedN : 0),
        unrealizedPnlInr: toMoneyString(u),
        totalPnlInr: toMoneyString(total),
      })
      .onConflictDoUpdate({
        target: [
          dailyPnlSnapshots.subscriptionId,
          dailyPnlSnapshots.snapshotDateIst,
        ],
        set: {
          realizedPnlInr: sql`excluded.realized_pnl_inr`,
          unrealizedPnlInr: sql`excluded.unrealized_pnl_inr`,
          totalPnlInr: sql`excluded.total_pnl_inr`,
        },
      });
    upserted += 1;
  }

  return { ok: true, targetIstDate: day, upsertedRows: upserted };
}

export type WeeklyRevenueJobResult = {
  ok: boolean;
  ran: boolean;
  weekStartIst: string;
  weekEndIst: string;
  ledgersInserted: number;
  ledgersSkipped: number;
  message?: string;
};

/**
 * Close the IST week `[weekStartIst, weekEndIst]` (inclusive calendar dates, Mon → Sun).
 * Percent is evaluated at **end of Sunday IST** so overrides effective through the week apply.
 */
export async function runWeeklyRevenueShareForIstWeek(
  weekStartIst: string,
  weekEndIst: string,
): Promise<WeeklyRevenueJobResult> {
  const ws = assertIstYmd("weekStartIst", weekStartIst);
  const we = assertIstYmd("weekEndIst", weekEndIst);
  if (!db) {
    return {
      ok: false,
      ran: false,
      weekStartIst: ws,
      weekEndIst: we,
      ledgersInserted: 0,
      ledgersSkipped: 0,
      message: "Database not configured.",
    };
  }

  const agg = await db
    .select({
      subscriptionId: dailyPnlSnapshots.subscriptionId,
      userId: dailyPnlSnapshots.userId,
      strategyId: userStrategySubscriptions.strategyId,
      weeklyNet: sql<string>`coalesce(sum(cast(${dailyPnlSnapshots.realizedPnlInr} as numeric)), 0)::text`,
    })
    .from(dailyPnlSnapshots)
    .innerJoin(
      userStrategySubscriptions,
      eq(dailyPnlSnapshots.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        gte(dailyPnlSnapshots.snapshotDateIst, ws),
        lte(dailyPnlSnapshots.snapshotDateIst, we),
      ),
    )
    .groupBy(
      dailyPnlSnapshots.subscriptionId,
      dailyPnlSnapshots.userId,
      userStrategySubscriptions.strategyId,
    );

  const evaluatedAt = istEndOfCalendarDayUtc(we);
  const dueAt = istDueFridayAfterWeekEndSunday(we);

  let inserted = 0;
  let skipped = 0;

  for (const row of agg) {
    const weeklyNet = Number(row.weeklyNet);
    const pct = await effectiveRevenueSharePercent(
      row.userId,
      row.strategyId,
      evaluatedAt,
    );
    const dueStr = weeklyAmountDue(weeklyNet, pct);
    const dueN = Number(dueStr);
    const pctN = Number(pct);
    const status = dueN > 0 ? ("unpaid" as const) : ("paid" as const);
    const autoClearedZero =
      dueN <= 0 &&
      (weeklyNet <= 0 || !Number.isFinite(pctN) || pctN <= 0);

    const meta = {
      weekly_net_profit_inr: toMoneyString(weeklyNet),
      snapshot_week_start_ist: ws,
      snapshot_week_end_ist: we,
      evaluated_at_utc: evaluatedAt.toISOString(),
      ...(autoClearedZero
        ? {
            zero_due: true as const,
            zero_due_reason:
              weeklyNet <= 0
                ? ("no_positive_net" as const)
                : ("zero_percent_or_rounding" as const),
          }
        : {}),
    };

    const paidAt = status === "paid" ? evaluatedAt : null;
    const amountPaidInr = status === "paid" ? dueStr : "0.00";

    const out = await db
      .insert(weeklyRevenueShareLedgers)
      .values({
        userId: row.userId,
        subscriptionId: row.subscriptionId,
        strategyId: row.strategyId,
        weekStartDateIst: ws,
        weekEndDateIst: we,
        amountDueInr: dueStr,
        amountPaidInr,
        revenueSharePercentApplied: pct,
        status,
        dueAt,
        paidAt,
        metadata: meta,
      })
      .onConflictDoNothing({
        target: [
          weeklyRevenueShareLedgers.subscriptionId,
          weeklyRevenueShareLedgers.weekStartDateIst,
        ],
      })
      .returning({ id: weeklyRevenueShareLedgers.id });

    if (out.length > 0) inserted += 1;
    else skipped += 1;
  }

  return {
    ok: true,
    ran: true,
    weekStartIst: ws,
    weekEndIst: we,
    ledgersInserted: inserted,
    ledgersSkipped: skipped,
  };
}
