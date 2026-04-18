import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  botOrderStatusEnum,
  botTradeSourceEnum,
  tradeSideEnum,
  virtualStrategyRunStatusEnum,
} from "./enums";
import { strategies } from "./strategies";
import { users } from "./users";

/**
 * One paper-trading account per user per strategy. No FK to subscriptions or exchange.
 * Balances are USD for display and simulation (isolated from INR billing tables).
 */
export const virtualStrategyRuns = pgTable(
  "virtual_strategy_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    status: virtualStrategyRunStatusEnum("status").notNull().default("active"),
    leverage: numeric("leverage", { precision: 10, scale: 2 }).notNull().default("1"),
    /** User-configurable baseline capital (used on full reset). */
    virtualCapitalUsd: numeric("virtual_capital_usd", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("10000"),
    /** Free cash not locked as initial margin. */
    virtualAvailableCashUsd: numeric("virtual_available_cash_usd", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("10000"),
    /** Initial margin locked for the open position (USD). */
    virtualUsedMarginUsd: numeric("virtual_used_margin_usd", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    virtualRealizedPnlUsd: numeric("virtual_realized_pnl_usd", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    openNetQty: numeric("open_net_qty", { precision: 24, scale: 8 })
      .notNull()
      .default("0"),
    openAvgEntryPrice: numeric("open_avg_entry_price", {
      precision: 24,
      scale: 8,
    }),
    openSymbol: text("open_symbol"),
    /** User overrides for this paper run (e.g. Hedge Scalping symbol). */
    runSettingsJson: jsonb("run_settings_json").$type<Record<string, unknown> | null>(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("virtual_strategy_runs_user_strategy_uidx").on(
      t.userId,
      t.strategyId,
    ),
    index("virtual_strategy_runs_user_idx").on(t.userId),
    index("virtual_strategy_runs_status_idx").on(t.status),
  ],
);

/**
 * Simulated fills only — no Delta order ids or exchange connection.
 * Correlates with `trading_execution_jobs.payload` for idempotency.
 */
export const virtualBotOrders = pgTable(
  "virtual_bot_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    internalClientOrderId: text("internal_client_order_id").notNull().unique(),
    correlationId: text("correlation_id"),
    virtualRunId: uuid("virtual_run_id")
      .notNull()
      .references(() => virtualStrategyRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    symbol: text("symbol").notNull(),
    side: tradeSideEnum("side").notNull(),
    orderType: text("order_type").notNull().default("market"),
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    limitPrice: numeric("limit_price", { precision: 24, scale: 8 }),
    status: botOrderStatusEnum("status").notNull().default("queued"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    tradeSource: botTradeSourceEnum("trade_source").notNull().default("bot"),
    venueOrderState: text("venue_order_state"),
    fillPrice: numeric("fill_price", { precision: 24, scale: 8 }),
    filledQty: numeric("filled_qty", { precision: 24, scale: 8 }),
    realizedPnlUsd: numeric("realized_pnl_usd", { precision: 14, scale: 2 }),
    /** Realized return on the closed notional for this fill (exit legs only). */
    profitPercent: numeric("profit_percent", { precision: 12, scale: 6 }),
    signalAction: text("signal_action"),
    rawSubmitResponse: jsonb("raw_submit_response").$type<Record<
      string,
      unknown
    > | null>(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("virtual_bot_orders_run_created_idx").on(t.virtualRunId, t.createdAt),
    index("virtual_bot_orders_user_created_idx").on(t.userId, t.createdAt),
    index("virtual_bot_orders_correlation_idx").on(t.correlationId),
    uniqueIndex("virtual_bot_orders_correlation_run_uidx")
      .on(t.correlationId, t.virtualRunId)
      .where(sql`${t.correlationId} IS NOT NULL`),
  ],
);
