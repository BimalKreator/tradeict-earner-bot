import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  exchangeConnectionStatusEnum,
  exchangeConnectionTestStatusEnum,
  exchangeProviderEnum,
} from "./enums";
import { users } from "./users";

export const exchangeConnections = pgTable(
  "exchange_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: exchangeProviderEnum("provider").notNull().default("delta_india"),
    status: exchangeConnectionStatusEnum("status").notNull().default("active"),
    /** AES-256-GCM ciphertext (see `exchange-secrets-crypto.ts`) */
    apiKeyCiphertext: text("api_key_ciphertext").notNull().default(""),
    apiSecretCiphertext: text("api_secret_ciphertext").notNull().default(""),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestStatus: exchangeConnectionTestStatusEnum("last_test_status")
      .notNull()
      .default("unknown"),
    lastTestMessage: text("last_test_message"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("exchange_connections_user_id_idx").on(t.userId),
    index("exchange_connections_user_provider_idx").on(t.userId, t.provider),
  ],
);
