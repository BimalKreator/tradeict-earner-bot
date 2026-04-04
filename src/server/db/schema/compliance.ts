import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { admins } from "./admins";
import {
  profileChangeRequestStatusEnum,
  termsDocumentStatusEnum,
} from "./enums";
import { users } from "./users";

/**
 * @deprecated Legacy table — use `terms_and_conditions`. Retained for DBs seeded before Phase 29.
 */
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

/** Version-controlled T&C (Markdown). Only one `published` row allowed (partial unique index). */
export const termsAndConditions = pgTable(
  "terms_and_conditions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionName: text("version_name").notNull(),
    /** Markdown (rendered on the public `/terms` page). */
    content: text("content").notNull(),
    status: termsDocumentStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("tac_status_idx").on(t.status),
    index("tac_updated_at_idx").on(t.updatedAt),
    uniqueIndex("tac_single_published_uidx")
      .on(t.status)
      .where(sql`${t.status} = 'published'`),
  ],
);

/**
 * Optional compliance gate: explicit acceptance of a specific terms revision.
 */
export const userAcceptedTerms = pgTable(
  "user_accepted_terms",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    termsId: uuid("terms_id")
      .notNull()
      .references(() => termsAndConditions.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.termsId] }),
    index("uat_user_idx").on(t.userId),
    index("uat_terms_idx").on(t.termsId),
  ],
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
