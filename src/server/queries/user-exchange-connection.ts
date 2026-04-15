import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { exchangeConnections } from "@/server/db/schema";

export type UserDeltaIndiaConnectionRow = {
  id: string;
  accountLabel: string;
  status: string;
  lastTestAt: Date | null;
  lastTestStatus: string;
  lastTestMessage: string | null;
  updatedAt: Date;
  hasStoredCredentials: boolean;
};

const rowSelect = {
  id: exchangeConnections.id,
  accountLabel: exchangeConnections.accountLabel,
  status: exchangeConnections.status,
  lastTestAt: exchangeConnections.lastTestAt,
  lastTestStatus: exchangeConnections.lastTestStatus,
  lastTestMessage: exchangeConnections.lastTestMessage,
  updatedAt: exchangeConnections.updatedAt,
  hasStoredCredentials: sql<boolean>`(
    length(trim(coalesce(${exchangeConnections.apiKeyCiphertext}, ''))) > 0
    and length(trim(coalesce(${exchangeConnections.apiSecretCiphertext}, ''))) > 0
  )`,
} as const;

/**
 * Non-secret fields only — never returns ciphertext or plaintext keys.
 * @deprecated Prefer `listUserDeltaIndiaExchangeConnections` for multi-account UI.
 */
export async function getUserDeltaIndiaConnection(
  userId: string,
): Promise<UserDeltaIndiaConnectionRow | null> {
  if (!db) return null;

  const [row] = await db
    .select(rowSelect)
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .orderBy(desc(exchangeConnections.updatedAt))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    accountLabel: row.accountLabel,
    status: row.status,
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt,
    hasStoredCredentials: Boolean(row.hasStoredCredentials),
  };
}

/** All active (non-deleted) Delta India API profiles for the user. */
export async function listUserDeltaIndiaExchangeConnections(
  userId: string,
): Promise<UserDeltaIndiaConnectionRow[]> {
  if (!db) return [];

  const rows = await db
    .select(rowSelect)
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .orderBy(desc(exchangeConnections.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    accountLabel: row.accountLabel,
    status: row.status,
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt,
    hasStoredCredentials: Boolean(row.hasStoredCredentials),
  }));
}
