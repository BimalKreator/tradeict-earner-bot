import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { admins } from "./admins";
import {
  userStrategyRunStatusEnum,
  userStrategySubscriptionStatusEnum,
} from "./enums";
import { strategies } from "./strategies";
import { users } from "./users";

export const userStrategySubscriptions = pgTable(
  "user_strategy_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    status: userStrategySubscriptionStatusEnum("status")
      .notNull()
      .default("purchased_pending_activation"),
    /**
     * Stacked access end: each successful renewal extends from max(now, current_end).
     * Application logic must enforce +30 days from that anchor.
     */
    accessValidUntil: timestamp("access_valid_until", {
      withTimezone: true,
    }).notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    firstActivationAt: timestamp("first_activation_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("uss_user_id_idx").on(t.userId),
    index("uss_strategy_id_idx").on(t.strategyId),
    index("uss_status_access_idx").on(t.status, t.accessValidUntil),
    index("uss_user_strategy_idx").on(t.userId, t.strategyId),
  ],
);

/** One activation/run record per subscription (state machine). */
export const userStrategyRuns = pgTable(
  "user_strategy_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => userStrategySubscriptions.id, { onDelete: "cascade" })
      .unique(),
    status: userStrategyRunStatusEnum("status").notNull().default("inactive"),
    capitalToUseInr: numeric("capital_to_use_inr", {
      precision: 14,
      scale: 2,
    }),
    leverage: numeric("leverage", { precision: 10, scale: 2 }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    lastStateReason: text("last_state_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("usr_status_idx").on(t.status)],
);

/** Admin-defined per-user per-strategy fee / revenue share overrides (time-bounded). */
export const userStrategyPricingOverrides = pgTable(
  "user_strategy_pricing_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    monthlyFeeInrOverride: numeric("monthly_fee_inr_override", {
      precision: 12,
      scale: 2,
    }),
    revenueSharePercentOverride: numeric("revenue_share_percent_override", {
      precision: 5,
      scale: 2,
    }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .defaultNow()
      .notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    /** When false, row is ignored for checkout / revenue resolution. */
    isActive: boolean("is_active").notNull().default(true),
    /** Internal admin-only context (not shown to end users). */
    adminNotes: text("admin_notes"),
    setByAdminId: uuid("set_by_admin_id").references(() => admins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("uspo_user_strategy_effective_idx").on(
      t.userId,
      t.strategyId,
      t.effectiveFrom,
    ),
    index("uspo_user_strategy_active_from_idx").on(
      t.userId,
      t.strategyId,
      t.isActive,
      t.effectiveFrom,
    ),
  ],
);
