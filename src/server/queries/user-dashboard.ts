import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";

import type {
  UserDashboardData,
  UserDashboardTradeRow,
} from "@/lib/user-dashboard-types";

import { db } from "@/server/db";
import {
  botOrders,
  exchangeConnections,
  strategies,
  trades,
  userStrategyRuns,
  userStrategySubscriptions,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export type { UserDashboardData, UserDashboardTradeRow };

/** YYYY-MM-DD in Asia/Kolkata for the given instant (server uses this for “today” boundaries). */
export function calendarDateIST(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const PAUSED_RUN_STATUSES = new Set<string>([
  "paused",
  "paused_revenue_due",
  "paused_exchange_off",
  "paused_admin",
  "paused_by_user",
  "blocked_revenue_due",
]);

const INACTIVE_RUN_STATUSES = new Set<string>([
  "inactive",
  "ready_to_activate",
  "expired",
]);

function exchangeBadge(
  row:
    | {
        status: string;
        lastTestStatus: string;
      }
    | undefined,
): UserDashboardData["exchange"] {
  if (!row) {
    return {
      label: "Not linked",
      connectionStatus: null,
      lastTestStatus: null,
    };
  }
  if (
    row.status === "disabled_user" ||
    row.status === "disabled_admin" ||
    row.status === "error"
  ) {
    return {
      label: "Disabled",
      connectionStatus: row.status,
      lastTestStatus: row.lastTestStatus,
    };
  }
  if (row.lastTestStatus === "invalid_credentials") {
    return {
      label: "Invalid",
      connectionStatus: row.status,
      lastTestStatus: row.lastTestStatus,
    };
  }
  if (row.status === "active" && row.lastTestStatus === "success") {
    return {
      label: "Connected",
      connectionStatus: row.status,
      lastTestStatus: row.lastTestStatus,
    };
  }
  return {
    label: "Needs attention",
    connectionStatus: row.status,
    lastTestStatus: row.lastTestStatus,
  };
}

async function pnlSeriesBotOrders(userId: string) {
  if (!db) return [];
  const result = await db.execute(sql`
    WITH ist_today AS (SELECT (timezone('Asia/Kolkata', now()))::date AS d),
    series AS (
      SELECT generate_series(
        (SELECT d FROM ist_today) - interval '6 days',
        (SELECT d FROM ist_today),
        interval '1 day'
      )::date AS bucket
    )
    SELECT series.bucket::text AS day_ist,
           COALESCE(SUM(bo.realized_pnl_inr), 0)::text AS pnl
    FROM series
    LEFT JOIN bot_orders bo ON bo.user_id = ${userId}::uuid
      AND bo.trade_source = 'bot'
      AND bo.status IN ('filled', 'partial_fill')
      AND (timezone('Asia/Kolkata', COALESCE(bo.last_synced_at, bo.updated_at)))::date = series.bucket
    GROUP BY series.bucket
    ORDER BY series.bucket
  `);
  return Array.from(result as unknown as Iterable<{ day_ist: string; pnl: string }>).map(
    (r) => ({ date: r.day_ist, pnlInr: r.pnl }),
  );
}

async function pnlSeriesTrades(userId: string) {
  if (!db) return [];
  const result = await db.execute(sql`
    WITH ist_today AS (SELECT (timezone('Asia/Kolkata', now()))::date AS d),
    series AS (
      SELECT generate_series(
        (SELECT d FROM ist_today) - interval '6 days',
        (SELECT d FROM ist_today),
        interval '1 day'
      )::date AS bucket
    )
    SELECT series.bucket::text AS day_ist,
           COALESCE(SUM(t.realized_pnl_inr), 0)::text AS pnl
    FROM series
    LEFT JOIN trades t ON t.user_id = ${userId}::uuid
      AND (timezone('Asia/Kolkata', t.executed_at))::date = series.bucket
    GROUP BY series.bucket
    ORDER BY series.bucket
  `);
  return Array.from(result as unknown as Iterable<{ day_ist: string; pnl: string }>).map(
    (r) => ({ date: r.day_ist, pnlInr: r.pnl }),
  );
}

/**
 * Aggregates dashboard metrics. Bot PnL uses `bot_orders.realized_pnl_inr` (filled/partial, trade_source bot),
 * attributed to the IST calendar day of `COALESCE(last_synced_at, updated_at)`.
 */
export async function getUserDashboardData(
  userId: string,
): Promise<UserDashboardData | null> {
  if (!db) return null;

  const todayIst = calendarDateIST();

  const [todayBotRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${botOrders.realizedPnlInr}), 0)::text`,
    })
    .from(botOrders)
    .where(
      and(
        eq(botOrders.userId, userId),
        eq(botOrders.tradeSource, "bot"),
        inArray(botOrders.status, ["filled", "partial_fill"]),
        sql`(timezone('Asia/Kolkata', coalesce(${botOrders.lastSyncedAt}, ${botOrders.updatedAt})))::date = ${todayIst}::date`,
      ),
    );

  const [totalBotRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${botOrders.realizedPnlInr}), 0)::text`,
    })
    .from(botOrders)
    .where(
      and(
        eq(botOrders.userId, userId),
        eq(botOrders.tradeSource, "bot"),
        inArray(botOrders.status, ["filled", "partial_fill"]),
      ),
    );

  const runRows = await db
    .select({ status: userStrategyRuns.status })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    );

  let runsActive = 0;
  let runsPaused = 0;
  let runsInactive = 0;
  for (const r of runRows) {
    if (r.status === "active") runsActive += 1;
    else if (PAUSED_RUN_STATUSES.has(r.status)) runsPaused += 1;
    else if (INACTIVE_RUN_STATUSES.has(r.status)) runsInactive += 1;
    else runsInactive += 1;
  }

  const [ec] = await db
    .select({
      status: exchangeConnections.status,
      lastTestStatus: exchangeConnections.lastTestStatus,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .orderBy(desc(exchangeConnections.updatedAt))
    .limit(1);

  const [revRow] = await db
    .select({
      total: sql<string>`coalesce(sum((${weeklyRevenueShareLedgers.amountDueInr})::numeric - (${weeklyRevenueShareLedgers.amountPaidInr})::numeric), 0)::text`,
    })
    .from(weeklyRevenueShareLedgers)
    .where(
      and(
        eq(weeklyRevenueShareLedgers.userId, userId),
        inArray(weeklyRevenueShareLedgers.status, ["unpaid", "partial"]),
        lte(weeklyRevenueShareLedgers.weekStartDateIst, todayIst),
        gte(weeklyRevenueShareLedgers.weekEndDateIst, todayIst),
      ),
    );

  const [chartBot, chartAll, botTradesRaw, allTradesRaw] = await Promise.all([
    pnlSeriesBotOrders(userId),
    pnlSeriesTrades(userId),
    db
      .select({
        id: botOrders.id,
        symbol: botOrders.symbol,
        side: botOrders.side,
        quantity: botOrders.quantity,
        fillPrice: botOrders.fillPrice,
        realizedPnlInr: botOrders.realizedPnlInr,
        updatedAt: botOrders.updatedAt,
        status: botOrders.status,
        strategyName: strategies.name,
      })
      .from(botOrders)
      .innerJoin(strategies, eq(botOrders.strategyId, strategies.id))
      .where(and(eq(botOrders.userId, userId), eq(botOrders.tradeSource, "bot")))
      .orderBy(desc(botOrders.updatedAt))
      .limit(5),
    db
      .select({
        id: trades.id,
        symbol: trades.symbol,
        side: trades.side,
        quantity: trades.quantity,
        price: trades.price,
        realizedPnlInr: trades.realizedPnlInr,
        executedAt: trades.executedAt,
        strategyName: strategies.name,
      })
      .from(trades)
      .innerJoin(strategies, eq(trades.strategyId, strategies.id))
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.executedAt))
      .limit(5),
  ]);

  return {
    asOf: new Date().toISOString(),
    todayBotPnlInr: todayBotRow?.total ?? "0",
    totalBotPnlInr: totalBotRow?.total ?? "0",
    runsActive,
    runsPaused,
    runsInactive,
    exchange: exchangeBadge(ec),
    revenueDueWeekInr: revRow?.total ?? "0",
    chartBot,
    chartAll,
    botTrades: botTradesRaw.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      quantity: String(t.quantity),
      priceOrFill: t.fillPrice != null ? String(t.fillPrice) : null,
      pnlInr: t.realizedPnlInr != null ? String(t.realizedPnlInr) : null,
      at: t.updatedAt.toISOString(),
      strategyName: t.strategyName,
      orderStatus: t.status,
    })),
    allTrades: allTradesRaw.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      quantity: String(t.quantity),
      priceOrFill: String(t.price),
      pnlInr: t.realizedPnlInr != null ? String(t.realizedPnlInr) : null,
      at: t.executedAt.toISOString(),
      strategyName: t.strategyName ?? undefined,
    })),
  };
}
