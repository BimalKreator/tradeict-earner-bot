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
  /** Sum of all ready Delta account balances for the user. */
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

  const ecs = await db
    .select({
      id: exchangeConnections.id,
      accountLabel: exchangeConnections.accountLabel,
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
    .limit(20);

  if (ecs.length === 0) {
    return {
      ok: false,
      code: "no_connection",
      message: "Connect Delta India on the Exchange page.",
    };
  }

  const readyConnections = ecs.filter(
    (ec) => ec.status === "active" && ec.lastTestStatus === "success",
  );
  if (readyConnections.length === 0) {
    return {
      ok: false,
      code: "exchange_not_ready",
      message: "Exchange connection must be active and successfully tested.",
    };
  }

  let encKey: Buffer;
  try {
    encKey = assertExchangeSecretsKeyConfigured();
  } catch {
    return {
      ok: false,
      code: "decrypt_failed",
      message: "Could not read exchange credentials.",
    };
  }
  let liveBalanceSum = 0;
  let availableMarginSum = 0;
  let netEquitySum = 0;
  let hasAnyBalance = false;
  let hasAnyAvailableMargin = false;
  let hasAnyNetEquity = false;
  const balanceErrors: string[] = [];
  let movements: DeltaWalletMovement[] = [];
  let transactionError: string | undefined;

  for (const ec of readyConnections) {
    try {
      const apiKey = decryptExchangeSecret(ec.apiKeyCiphertext, encKey);
      const apiSecret = decryptExchangeSecret(ec.apiSecretCiphertext, encKey);
      const adapter = new DeltaIndiaTradingAdapter(apiKey, apiSecret);
      const [bal, tx] = await Promise.all([
        adapter.fetchWalletBalances(),
        adapter.fetchWalletTransactions({ pageSize: 10 }),
      ]);

      if (movements.length === 0) {
        if (tx.ok) movements = tx.movements;
        else transactionError = tx.error;
      }

      if (!bal.ok) {
        balanceErrors.push(`${ec.accountLabel}: ${bal.error}`);
        continue;
      }

      const liveNum = Number(bal.liveBalanceDisplay);
      if (Number.isFinite(liveNum)) {
        liveBalanceSum += liveNum;
        hasAnyBalance = true;
      }

      const marginNum = Number(bal.availableMarginTotal);
      if (Number.isFinite(marginNum)) {
        availableMarginSum += marginNum;
        hasAnyAvailableMargin = true;
      }

      const netEqNum = Number(bal.netEquity);
      if (Number.isFinite(netEqNum)) {
        netEquitySum += netEqNum;
        hasAnyNetEquity = true;
      }
    } catch {
      balanceErrors.push(`${ec.accountLabel}: credentials unavailable`);
    }
  }

  if (!hasAnyBalance && readyConnections.length > 0) {
    return {
      ok: false,
      code: "unknown",
      message: "Could not fetch balances from ready Delta profiles.",
    };
  }

  const { netSigned } = netExternalFlowFromMovements(movements);
  const liveNum = hasAnyBalance ? liveBalanceSum : NaN;
  const netFundFlow =
    Number.isFinite(liveNum) && Number.isFinite(netSigned)
      ? String(liveNum - netSigned)
      : null;

  return {
    ok: true,
    asOf: new Date().toISOString(),
    liveBalance: hasAnyBalance ? String(liveBalanceSum) : null,
    availableMargin: hasAnyAvailableMargin ? String(availableMarginSum) : null,
    netEquity: hasAnyNetEquity ? String(netEquitySum) : null,
    netFundFlow,
    netExternalMovementHint: Number.isFinite(netSigned) ? String(netSigned) : null,
    movements,
    balanceError: balanceErrors.length > 0 ? balanceErrors.join(" | ") : undefined,
    transactionError,
  };
}
