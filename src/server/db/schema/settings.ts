import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Key/value settings (JSON payload) for platform defaults and feature flags.
 * Prefer typed keys in application code (e.g. default_monthly_fee_inr).
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
