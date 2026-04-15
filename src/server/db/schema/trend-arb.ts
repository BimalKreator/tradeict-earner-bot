import { index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { userStrategyRuns } from "./subscriptions";

/** One row per (run, hedge step) after a Delta 2 clip was dispatched for that 1% step. */
export const trendArbHedgeState = pgTable(
  "trend_arb_hedge_state",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => userStrategyRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.stepIndex] }),
    index("trend_arb_hedge_state_run_idx").on(t.runId),
  ],
);
