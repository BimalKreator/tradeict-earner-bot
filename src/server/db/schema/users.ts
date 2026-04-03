import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { admins } from "./admins";
import { userApprovalStatusEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    address: text("address"),
    phone: text("phone"),
    whatsappNumber: text("whatsapp_number"),
    /** Optional; primary login is email OTP in the product spec */
    passwordHash: text("password_hash"),
    approvalStatus: userApprovalStatusEnum("approval_status")
      .notNull()
      .default("pending_approval"),
    approvalNotes: text("approval_notes"),
    /** Staff-only notes; never shown to the end user */
    adminInternalNotes: text("admin_internal_notes"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByAdminId: uuid("approved_by_admin_id").references(() => admins.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("users_approval_status_idx").on(t.approvalStatus),
    index("users_deleted_at_idx").on(t.deletedAt),
  ],
);
