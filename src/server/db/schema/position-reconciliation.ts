import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { exchangeConnections } from "./exchange";
import { users } from "./users";

/**
 * Read-only reconciliation snapshot between local `bot_positions` and venue-reported open positions.
 * One row per exchange connection + symbol, overwritten on each reconciliation pass.
 */
export const livePositionReconciliations = pgTable(
  "live_position_reconciliations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exchangeConnectionId: uuid("exchange_connection_id")
      .notNull()
      .references(() => exchangeConnections.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    localNetQty: numeric("local_net_qty", { precision: 24, scale: 8 }).notNull().default("0"),
    exchangeNetQty: numeric("exchange_net_qty", { precision: 24, scale: 8 }).notNull().default("0"),
    qtyDiff: numeric("qty_diff", { precision: 24, scale: 8 }).notNull().default("0"),
    mismatch: text("mismatch").notNull().default("no"),
    status: text("status").notNull().default("ok"),
    errorMessage: text("error_message"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_position_reconciliations_exchange_symbol_uidx").on(
      t.exchangeConnectionId,
      t.symbol,
    ),
    index("live_position_reconciliations_user_idx").on(t.userId),
    index("live_position_reconciliations_reconciled_idx").on(t.reconciledAt),
  ],
);
