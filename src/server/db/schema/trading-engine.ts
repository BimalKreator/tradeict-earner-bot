import { sql } from "drizzle-orm";
import {
  index,
  integer,
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
  tradingJobStatusEnum,
} from "./enums";
import { exchangeConnections } from "./exchange";
import { strategies } from "./strategies";
import { userStrategyRuns, userStrategySubscriptions } from "./subscriptions";
import { users } from "./users";

export const botOrders = pgTable(
  "bot_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    internalClientOrderId: text("internal_client_order_id").notNull().unique(),
    correlationId: text("correlation_id"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => userStrategySubscriptions.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => userStrategyRuns.id, { onDelete: "cascade" }),
    exchangeConnectionId: uuid("exchange_connection_id")
      .notNull()
      .references(() => exchangeConnections.id, { onDelete: "restrict" }),
    symbol: text("symbol").notNull(),
    side: tradeSideEnum("side").notNull(),
    orderType: text("order_type").notNull().default("market"),
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    limitPrice: numeric("limit_price", { precision: 24, scale: 8 }),
    status: botOrderStatusEnum("status").notNull().default("draft"),
    externalOrderId: text("external_order_id"),
    externalClientOrderId: text("external_client_order_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    rawSubmitResponse: jsonb("raw_submit_response").$type<Record<
      string,
      unknown
    > | null>(),
    rawSyncResponse: jsonb("raw_sync_response").$type<Record<
      string,
      unknown
    > | null>(),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    tradeSource: botTradeSourceEnum("trade_source").notNull().default("bot"),
    /** Last known Delta `state` (open, pending, closed, cancelled). */
    venueOrderState: text("venue_order_state"),
    fillPrice: numeric("fill_price", { precision: 24, scale: 8 }),
    filledQty: numeric("filled_qty", { precision: 24, scale: 8 }),
    /** Set when fill/PnL is known (e.g. from exchange); dashboard sums this for bot PnL. */
    realizedPnlInr: numeric("realized_pnl_inr", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("bot_orders_user_created_idx").on(t.userId, t.createdAt),
    index("bot_orders_subscription_idx").on(t.subscriptionId),
    index("bot_orders_correlation_idx").on(t.correlationId),
    index("bot_orders_user_pnl_day_idx").on(t.userId, t.lastSyncedAt),
    uniqueIndex("bot_orders_correlation_subscription_uidx")
      .on(t.correlationId, t.subscriptionId)
      .where(sql`${t.correlationId} IS NOT NULL`),
  ],
);

export const botExecutionLogs = pgTable(
  "bot_execution_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    botOrderId: uuid("bot_order_id")
      .notNull()
      .references(() => botOrders.id, { onDelete: "cascade" }),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("bot_execution_logs_order_created_idx").on(t.botOrderId, t.createdAt),
  ],
);

export const botPositions = pgTable(
  "bot_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => userStrategySubscriptions.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    symbol: text("symbol").notNull(),
    netQuantity: numeric("net_quantity", { precision: 24, scale: 8 })
      .notNull()
      .default("0"),
    averageEntryPrice: numeric("average_entry_price", {
      precision: 24,
      scale: 8,
    }),
    unrealizedPnlInr: numeric("unrealized_pnl_inr", {
      precision: 14,
      scale: 2,
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("bot_positions_subscription_symbol_uidx").on(
      t.subscriptionId,
      t.symbol,
    ),
    index("bot_positions_user_idx").on(t.userId),
  ],
);

export type TradingExecutionJobPayload = {
  kind: "execute_strategy_signal";
  strategyId: string;
  correlationId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: string;
  limitPrice?: string | null;
  targetUserId: string;
  subscriptionId: string;
  runId: string;
  signalMetadata?: Record<string, unknown>;
};

export const tradingExecutionJobs = pgTable(
  "trading_execution_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobKind: text("job_kind").notNull().default("execute_strategy_signal"),
    correlationId: text("correlation_id").notNull(),
    status: tradingJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    payload: jsonb("payload").$type<TradingExecutionJobPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("trading_jobs_status_run_idx").on(t.status, t.runAt),
    index("trading_jobs_correlation_idx").on(t.correlationId),
  ],
);
