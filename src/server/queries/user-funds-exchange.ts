import { and, desc, eq, isNull } from "drizzle-orm";

import {
  assertExchangeSecretsKeyConfigured,
  decryptExchangeSecret,
} from "@/server/exchange/exchange-secrets-crypto";
import type { DeltaWalletMovement } from "@/server/exchange/delta-india-wallet-types";
import { db } from "@/server/db";
import { exchangeConnections } from "@/server/db/schema";
import { DeltaIndiaTradingAdapter } from "@/server/trading/adapters/delta-india-trading-adapter";

/**
 * Heuristic net external funding from the latest wallet movements page only.
 * Deposit-like types add; withdrawal-like types subtract. Unknown types ignored.
 */
export function netExternalFlowFromMovements(
  movements: DeltaWalletMovement[],
): { netSigned: number; depositLike: number; withdrawLike: number } {
  let depositLike = 0;
  let withdrawLike = 0;
  for (const m of movements) {
    const t = m.transactionType.toLowerCase();
    const amt = Math.abs(Number(m.amount));
    if (!Number.isFinite(amt)) continue;
    if (t.includes("withdraw")) {
      withdrawLike += amt;
    } else if (
      t.includes("deposit") ||
      (t.includes("credit") && !t.includes("fee") && !t.includes("commission"))
    ) {
      depositLike += amt;
    }
  }
  return {
    netSigned: depositLike - withdrawLike,
    depositLike,
    withdrawLike,
  };
}

export type UserFundsLiveExchangePayload = {
  ok: true;
  asOf: string;
  liveBalance: string | null;
  availableMargin: string | null;
  netEquity: string | null;
  netFundFlow: string | null;
  /** Net deposits − withdrawals heuristic on the fetched page (see UI disclaimer). */
  netExternalMovementHint: string | null;
  movements: DeltaWalletMovement[];
  balanceError?: string;
  transactionError?: string;
};

export type UserFundsLiveExchangeError = {
  ok: false;
  code:
    | "no_database"
    | "no_connection"
    | "exchange_not_ready"
    | "decrypt_failed"
    | "unknown";
  message: string;
};

/**
 * Live Delta wallet read using the same credentials as trading (`DeltaIndiaTradingAdapter`).
 * Does not require `DELTA_TRADING_ENABLED` — read-only wallet endpoints.
 */
export async function fetchUserFundsLiveFromDelta(
  userId: string,
): Promise<UserFundsLiveExchangePayload | UserFundsLiveExchangeError> {
  if (!db) {
    return {
      ok: false,
      code: "no_database",
      message: "Database not configured.",
    };
  }

  const [ec] = await db
    .select({
      status: exchangeConnections.status,
      lastTestStatus: exchangeConnections.lastTestStatus,
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
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

  if (!ec) {
    return {
      ok: false,
      code: "no_connection",
      message: "Connect Delta India on the Exchange page.",
    };
  }

  if (ec.status !== "active" || ec.lastTestStatus !== "success") {
    return {
      ok: false,
      code: "exchange_not_ready",
      message: "Exchange connection must be active and successfully tested.",
    };
  }

  let adapter: DeltaIndiaTradingAdapter;
  try {
    const encKey = assertExchangeSecretsKeyConfigured();
    const apiKey = decryptExchangeSecret(ec.apiKeyCiphertext, encKey);
    const apiSecret = decryptExchangeSecret(ec.apiSecretCiphertext, encKey);
    adapter = new DeltaIndiaTradingAdapter(apiKey, apiSecret);
  } catch {
    return {
      ok: false,
      code: "decrypt_failed",
      message: "Could not read exchange credentials.",
    };
  }

  const [bal, tx] = await Promise.all([
    adapter.fetchWalletBalances(),
    adapter.fetchWalletTransactions({ pageSize: 10 }),
  ]);

  const movements = tx.ok ? tx.movements : [];
  const { netSigned } = netExternalFlowFromMovements(movements);

  let liveBalance: string | null = null;
  let availableMargin: string | null = null;
  let netEquity: string | null = null;
  let balanceError: string | undefined;

  if (bal.ok) {
    liveBalance = bal.liveBalanceDisplay;
    availableMargin = bal.availableMarginTotal;
    netEquity = bal.netEquity;
  } else {
    balanceError = bal.error;
  }

  const liveNum = liveBalance != null ? Number(liveBalance) : NaN;
  const netFundFlow =
    Number.isFinite(liveNum) && Number.isFinite(netSigned)
      ? String(liveNum - netSigned)
      : null;

  return {
    ok: true,
    asOf: new Date().toISOString(),
    liveBalance,
    availableMargin,
    netEquity,
    netFundFlow,
    netExternalMovementHint: Number.isFinite(netSigned) ? String(netSigned) : null,
    movements,
    balanceError,
    transactionError: tx.ok ? undefined : tx.error,
  };
}
