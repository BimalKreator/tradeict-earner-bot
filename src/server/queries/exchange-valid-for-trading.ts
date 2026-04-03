import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/server/db";
import { exchangeConnections } from "@/server/db/schema";

/**
 * Delta India connection ready for bot trading: active, keys present, last test success.
 */
export async function hasValidDeltaIndiaConnectionForTrading(
  userId: string,
): Promise<boolean> {
  if (!db) return false;

  const rows = await db
    .select({ id: exchangeConnections.id })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
        eq(exchangeConnections.status, "active"),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return false;

  const [full] = await db
    .select({
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
      lastTestStatus: exchangeConnections.lastTestStatus,
    })
    .from(exchangeConnections)
    .where(eq(exchangeConnections.id, row.id))
    .limit(1);

  if (!full) return false;
  if (
    !full.apiKeyCiphertext?.trim() ||
    !full.apiSecretCiphertext?.trim()
  ) {
    return false;
  }
  return full.lastTestStatus === "success";
}
