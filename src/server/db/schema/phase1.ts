import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Phase 1 connectivity probe table — retained for health checks and migration history.
 */
export const connectivityCheck = pgTable("connectivity_check", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull().default("phase1"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
