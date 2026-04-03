import { sql } from "drizzle-orm";
import {
  date,
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

import { admins } from "./admins";
import {
  invoiceStatusEnum,
  paymentProviderEnum,
  paymentStatusEnum,
  revenueLedgerStatusEnum,
} from "./enums";
import { strategies } from "./strategies";
import { userStrategySubscriptions } from "./subscriptions";
import { users } from "./users";

/**
 * Weekly revenue share in IST calendar boundaries (inclusive dates stored as date).
 * Declared before `payments` so Cashfree rows can FK to a specific ledger week.
 */
export const weeklyRevenueShareLedgers = pgTable(
  "weekly_revenue_share_ledgers",
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
    weekStartDateIst: date("week_start_date_ist").notNull(),
    weekEndDateIst: date("week_end_date_ist").notNull(),
    amountDueInr: numeric("amount_due_inr", { precision: 14, scale: 2 })
      .notNull(),
    amountPaidInr: numeric("amount_paid_inr", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    /** Snapshot of effective % at week close (override or strategy default); never infer from live joins later. */
    revenueSharePercentApplied: numeric("revenue_share_percent_applied", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0"),
    status: revenueLedgerStatusEnum("status").notNull().default("unpaid"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** Internal admin-only notes (not shown to end users). */
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("wrsl_user_status_idx").on(t.userId, t.status),
    index("wrsl_subscription_idx").on(t.subscriptionId),
    uniqueIndex("wrsl_subscription_week_uidx").on(
      t.subscriptionId,
      t.weekStartDateIst,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    strategyId: uuid("strategy_id").references(() => strategies.id, {
      onDelete: "restrict",
    }),
    /** When set, this Cashfree order settles a weekly revenue-share ledger (not subscription). */
    revenueShareLedgerId: uuid("revenue_share_ledger_id").references(
      () => weeklyRevenueShareLedgers.id,
      { onDelete: "set null" },
    ),
    provider: paymentProviderEnum("provider").notNull().default("cashfree"),
    externalOrderId: text("external_order_id"),
    externalPaymentId: text("external_payment_id"),
    amountInr: numeric("amount_inr", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    subscriptionId: uuid("subscription_id").references(
      () => userStrategySubscriptions.id,
      { onDelete: "set null" },
    ),
    /** Access days purchased (default 30 per product rules) */
    accessDaysPurchased: integer("access_days_purchased").notNull().default(30),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("payments_user_status_idx").on(t.userId, t.status),
    index("payments_subscription_idx").on(t.subscriptionId),
    index("payments_strategy_id_idx").on(t.strategyId),
    index("payments_revenue_ledger_idx").on(t.revenueShareLedgerId),
    uniqueIndex("payments_provider_order_uidx")
      .on(t.provider, t.externalOrderId)
      .where(sql`${t.externalOrderId} IS NOT NULL`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" })
      .unique(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    amountInr: numeric("amount_inr", { precision: 12, scale: 2 }).notNull(),
    taxAmountInr: numeric("tax_amount_inr", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    lineDescription: text("line_description"),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("invoices_status_idx").on(t.status)],
);

export const feeWaivers = pgTable(
  "fee_waivers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id").references(() => strategies.id, {
      onDelete: "set null",
    }),
    subscriptionId: uuid("subscription_id").references(
      () => userStrategySubscriptions.id,
      { onDelete: "set null" },
    ),
    revenueLedgerId: uuid("revenue_ledger_id").references(
      () => weeklyRevenueShareLedgers.id,
      { onDelete: "set null" },
    ),
    /** Null = full waiver of linked ledger row */
    amountInr: numeric("amount_inr", { precision: 14, scale: 2 }),
    reason: text("reason").notNull(),
    createdByAdminId: uuid("created_by_admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("fee_waivers_user_idx").on(t.userId),
    index("fee_waivers_ledger_idx").on(t.revenueLedgerId),
  ],
);
