import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { userStrategyRuns } from "./subscriptions";

export type TrendProfitLockStep = {
  step: number;
  stepTriggerPct: number;
  stepQtyPctOfD1: number;
  targetLinkType: "D1_ENTRY" | "STEP_1_ENTRY" | "STEP_2_ENTRY" | "STEP_3_ENTRY" | "STEP_4_ENTRY";
  stepStoplossPct: number;
};

export const trendProfitLockSettings = pgTable(
  "trend_profit_lock_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .unique()
      .references(() => userStrategyRuns.id, { onDelete: "cascade" }),
    timeframe: text("timeframe").notNull().default("1m"),
    halftrendAmplitude: integer("halftrend_amplitude").notNull().default(2),
    symbol: text("symbol").notNull().default("BTCUSD"),
    d1CapitalAllocationPct: integer("d1_capital_allocation_pct").notNull().default(100),
    d1TargetPct: integer("d1_target_pct").notNull().default(12),
    d1StoplossPct: integer("d1_stoploss_pct").notNull().default(1),
    d1BreakevenTriggerPct: integer("d1_breakeven_trigger_pct").notNull().default(30),
    d2StepsJson: jsonb("d2_steps_json").$type<TrendProfitLockStep[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("trend_profit_lock_settings_run_idx").on(t.runId)],
);
