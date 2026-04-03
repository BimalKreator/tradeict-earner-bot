import { sql } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { tradeSideEnum } from "./enums";
import { exchangeConnections } from "./exchange";
import { strategies } from "./strategies";
import { userStrategySubscriptions } from "./subscriptions";
import { users } from "./users";

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(
      () => userStrategySubscriptions.id,
      { onDelete: "set null" },
    ),
    exchangeConnectionId: uuid("exchange_connection_id").references(
      () => exchangeConnections.id,
      { onDelete: "set null" },
    ),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    externalTradeId: text("external_trade_id").notNull(),
    symbol: text("symbol").notNull(),
    side: tradeSideEnum("side").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    price: numeric("price", { precision: 24, scale: 8 }).notNull(),
    feeInr: numeric("fee_inr", { precision: 14, scale: 2 }),
    realizedPnlInr: numeric("realized_pnl_inr", { precision: 14, scale: 2 }),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("trades_user_executed_idx").on(t.userId, t.executedAt),
    index("trades_subscription_idx").on(t.subscriptionId),
    index("trades_strategy_idx").on(t.strategyId),
    uniqueIndex("trades_exchange_external_uidx")
      .on(t.exchangeConnectionId, t.externalTradeId)
      .where(sql`${t.exchangeConnectionId} IS NOT NULL`),
  ],
);

export const dailyPnlSnapshots = pgTable(
  "daily_pnl_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => userStrategySubscriptions.id, { onDelete: "cascade" }),
    snapshotDateIst: date("snapshot_date_ist").notNull(),
    realizedPnlInr: numeric("realized_pnl_inr", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    unrealizedPnlInr: numeric("unrealized_pnl_inr", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalPnlInr: numeric("total_pnl_inr", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("daily_pnl_user_date_idx").on(t.userId, t.snapshotDateIst),
    uniqueIndex("daily_pnl_subscription_date_uidx").on(
      t.subscriptionId,
      t.snapshotDateIst,
    ),
  ],
);
