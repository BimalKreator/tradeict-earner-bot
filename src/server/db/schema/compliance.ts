import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { admins } from "./admins";
import { profileChangeRequestStatusEnum } from "./enums";
import { users } from "./users";

export const termsVersions = pgTable(
  "terms_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Monotonic version for display and ordering */
    version: integer("version").notNull().unique(),
    title: text("title"),
    contentMd: text("content_md").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull(),
    createdByAdminId: uuid("created_by_admin_id").references(() => admins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("terms_effective_from_idx").on(t.effectiveFrom)],
);

/**
 * Stores proposed field changes as JSON: { field: { old, new }, ... }
 */
export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    changesJson: jsonb("changes_json")
      .notNull()
      .$type<Record<string, { old: unknown; new: unknown }>>(),
    status: profileChangeRequestStatusEnum("status")
      .notNull()
      .default("pending"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(
      () => admins.id,
      { onDelete: "set null" },
    ),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("pcr_user_status_idx").on(t.userId, t.status),
    index("pcr_status_idx").on(t.status),
  ],
);
