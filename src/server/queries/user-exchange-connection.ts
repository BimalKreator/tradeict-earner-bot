import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { exchangeConnections } from "@/server/db/schema";

export type UserDeltaIndiaConnectionRow = {
  id: string;
  status: string;
  lastTestAt: Date | null;
  lastTestStatus: string;
  lastTestMessage: string | null;
  updatedAt: Date;
  hasStoredCredentials: boolean;
};

/**
 * Non-secret fields only — never returns ciphertext or plaintext keys.
 */
export async function getUserDeltaIndiaConnection(
  userId: string,
): Promise<UserDeltaIndiaConnectionRow | null> {
  if (!db) return null;

  const [row] = await db
    .select({
      id: exchangeConnections.id,
      status: exchangeConnections.status,
      lastTestAt: exchangeConnections.lastTestAt,
      lastTestStatus: exchangeConnections.lastTestStatus,
      lastTestMessage: exchangeConnections.lastTestMessage,
      updatedAt: exchangeConnections.updatedAt,
      hasStoredCredentials: sql<boolean>`(
        length(trim(coalesce(${exchangeConnections.apiKeyCiphertext}, ''))) > 0
        and length(trim(coalesce(${exchangeConnections.apiSecretCiphertext}, ''))) > 0
      )`,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt,
    hasStoredCredentials: Boolean(row.hasStoredCredentials),
  };
}
