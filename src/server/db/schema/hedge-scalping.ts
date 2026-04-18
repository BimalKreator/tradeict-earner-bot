import { sql } from "drizzle-orm";
import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { strategies } from "./strategies";
import { users } from "./users";

export const hedgeScalpingVirtualRunStatusEnum = pgEnum(
  "hedge_scalping_virtual_run_status",
  ["active", "completed", "failed"],
);

export const hedgeScalpingVirtualClipStatusEnum = pgEnum(
  "hedge_scalping_virtual_clip_status",
  ["active", "completed"],
);

export const hedgeScalpingPositionSideEnum = pgEnum("hedge_scalping_position_side", [
  "LONG",
  "SHORT",
]);

/**
 * Isolated paper state for Hedge Scalping (dual account). Not tied to `virtual_strategy_runs`
 * rows — link is logical via the same `user_id` + `strategy_id`.
 */
export const hedgeScalpingVirtualRuns = pgTable(
  "hedge_scalping_virtual_runs",
  {
    runId: uuid("run_id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    status: hedgeScalpingVirtualRunStatusEnum("status").notNull().default("active"),
    d1Side: hedgeScalpingPositionSideEnum("d1_side").notNull(),
    d1EntryPrice: numeric("d1_entry_price", { precision: 24, scale: 8 }).notNull(),
    maxFavorablePrice: numeric("max_favorable_price", {
      precision: 24,
      scale: 8,
    }).notNull(),
    /** D1 position size in contracts / coin units (sized from virtual capital × baseQty%). */
    d1Qty: numeric("d1_qty", { precision: 24, scale: 8 }).notNull().default("0"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("hedge_scalping_virtual_runs_user_idx").on(t.userId),
    index("hedge_scalping_virtual_runs_strategy_idx").on(t.strategyId),
    index("hedge_scalping_virtual_runs_status_idx").on(t.status),
    uniqueIndex("hedge_scalping_virtual_runs_user_strategy_active_uidx")
      .on(t.userId, t.strategyId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const hedgeScalpingVirtualClips = pgTable(
  "hedge_scalping_virtual_clips",
  {
    clipId: uuid("clip_id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => hedgeScalpingVirtualRuns.runId, { onDelete: "cascade" }),
    stepLevel: integer("step_level").notNull(),
    entryPrice: numeric("entry_price", { precision: 24, scale: 8 }).notNull(),
    side: hedgeScalpingPositionSideEnum("side").notNull(),
    /** Clip size in contracts (step qty % × run d1_qty). */
    qty: numeric("qty", { precision: 24, scale: 8 }).notNull().default("0"),
    status: hedgeScalpingVirtualClipStatusEnum("status").notNull().default("active"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("hedge_scalping_virtual_clips_run_idx").on(t.runId),
    index("hedge_scalping_virtual_clips_run_status_idx").on(t.runId, t.status),
  ],
);
