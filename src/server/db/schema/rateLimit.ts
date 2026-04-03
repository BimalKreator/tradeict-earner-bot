import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Fixed-window counters for auth rate limiting (password attempts, OTP sends, OTP verifies).
 * Key format: e.g. `pwd:email@x.com`, `otp_send:email@x.com`, `otp_verify:userId`.
 */
export const authRateBuckets = pgTable("auth_rate_buckets", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .notNull(),
});
