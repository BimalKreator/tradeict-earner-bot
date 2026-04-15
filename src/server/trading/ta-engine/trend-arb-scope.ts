import { and, eq, isNull } from "drizzle-orm";

import { decryptExchangeSecret } from "@/server/exchange/exchange-secrets-crypto";
import { db } from "@/server/db";
import {
  exchangeConnections,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";

export type TrendArbExecutionScope = {
  runId: string;
  userId: string;
  subscriptionId: string;
  strategyId: string;
  primaryExchangeConnectionId: string;
  secondaryExchangeConnectionId: string | null;
};

export async function loadTrendArbExecutionScope(
  runId: string,
  expectedStrategyId: string,
  primaryExchangeConnectionId: string,
  secondaryExchangeConnectionId: string | null,
): Promise<
  { ok: true; scope: TrendArbExecutionScope } | { ok: false; error: string }
> {
  if (!db) return { ok: false, error: "database_unavailable" };

  const [row] = await db
    .select({
      runId: userStrategyRuns.id,
      subscriptionId: userStrategyRuns.subscriptionId,
      strategyId: userStrategySubscriptions.strategyId,
      userId: userStrategySubscriptions.userId,
      runPrimary: userStrategyRuns.primaryExchangeConnectionId,
      runSecondary: userStrategyRuns.secondaryExchangeConnectionId,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategyRuns.id, runId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, error: "run_not_found" };
  }
  if (row.strategyId !== expectedStrategyId) {
    return { ok: false, error: "run_strategy_mismatch" };
  }

  const [pri] = await db
    .select({ id: exchangeConnections.id })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.id, primaryExchangeConnectionId),
        eq(exchangeConnections.userId, row.userId),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .limit(1);
  if (!pri) {
    return { ok: false, error: "primary_exchange_not_owned_by_run_user" };
  }

  if (secondaryExchangeConnectionId) {
    const [sec] = await db
      .select({ id: exchangeConnections.id })
      .from(exchangeConnections)
      .where(
        and(
          eq(exchangeConnections.id, secondaryExchangeConnectionId),
          eq(exchangeConnections.userId, row.userId),
          isNull(exchangeConnections.deletedAt),
        ),
      )
      .limit(1);
    if (!sec) {
      return { ok: false, error: "secondary_exchange_not_owned_by_run_user" };
    }
  }

  return {
    ok: true,
    scope: {
      runId: row.runId,
      userId: row.userId,
      subscriptionId: row.subscriptionId,
      strategyId: row.strategyId,
      primaryExchangeConnectionId,
      secondaryExchangeConnectionId,
    },
  };
}

export async function getDeltaCredentialsForConnection(params: {
  userId: string;
  connectionId: string;
}): Promise<
  { ok: true; apiKey: string; apiSecret: string } | { ok: false; error: string }
> {
  if (!db) return { ok: false, error: "database_unavailable" };
  const encKey = process.env.EXCHANGE_SECRETS_ENCRYPTION_KEY?.trim();
  if (!encKey) {
    return { ok: false, error: "EXCHANGE_SECRETS_ENCRYPTION_KEY_missing" };
  }
  const keyBuf = Buffer.from(encKey, "utf8");
  if (keyBuf.length !== 32) {
    return { ok: false, error: "EXCHANGE_SECRETS_ENCRYPTION_KEY_invalid_length" };
  }

  const [ec] = await db
    .select({
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.id, params.connectionId),
        eq(exchangeConnections.userId, params.userId),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .limit(1);

  if (!ec) return { ok: false, error: "exchange_connection_not_found" };
  try {
    const apiKey = decryptExchangeSecret(ec.apiKeyCiphertext, keyBuf);
    const apiSecret = decryptExchangeSecret(ec.apiSecretCiphertext, keyBuf);
    return { ok: true, apiKey, apiSecret };
  } catch {
    return { ok: false, error: "exchange_decrypt_failed" };
  }
}
