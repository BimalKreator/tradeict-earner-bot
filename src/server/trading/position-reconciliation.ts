import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  botPositions,
  exchangeConnections,
  livePositionReconciliations,
  userStrategyRuns,
} from "@/server/db/schema";

import { resolveExchangeTradingAdapter } from "./adapters/resolve-exchange-adapter";
import { tradingLog } from "./trading-log";

const QTY_EPS = 1e-8;
const AUTO_FLATTEN_CONFIRMATIONS_REQUIRED = Math.max(
  1,
  Number(process.env.POSITION_RECONCILIATION_AUTO_FLATTEN_CONFIRMATIONS ?? "2") || 2,
);

function num(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function toFixedQty(v: number): string {
  return Number.isFinite(v) ? v.toFixed(8) : "0";
}

type ReconcileTargetConnection = {
  id: string;
  userId: string;
  provider: "delta_india";
  apiKeyCiphertext: string;
  apiSecretCiphertext: string;
};

async function upsertSnapshot(params: {
  userId: string;
  exchangeConnectionId: string;
  symbol: string;
  localNetQty: number;
  exchangeNetQty: number;
  mismatch: boolean;
  status: "ok" | "error";
  errorMessage?: string | null;
  rawPayload?: Record<string, unknown> | null;
  reconciledAt: Date;
}): Promise<void> {
  if (!db) return;
  const qtyDiff = params.localNetQty - params.exchangeNetQty;
  const rawPayloadJson =
    params.rawPayload != null ? JSON.stringify(params.rawPayload) : null;
  const reconciledAtIso = params.reconciledAt.toISOString();
  await db.execute(sql`
    INSERT INTO live_position_reconciliations
      (id, user_id, exchange_connection_id, symbol, local_net_qty, exchange_net_qty, qty_diff, mismatch, status, error_message, raw_payload, reconciled_at, updated_at)
    VALUES
      (
        gen_random_uuid(),
        ${params.userId}::uuid,
        ${params.exchangeConnectionId}::uuid,
        ${params.symbol},
        ${toFixedQty(params.localNetQty)}::numeric,
        ${toFixedQty(params.exchangeNetQty)}::numeric,
        ${toFixedQty(qtyDiff)}::numeric,
        ${params.mismatch ? "yes" : "no"},
        ${params.status},
        ${params.errorMessage ?? null},
        ${rawPayloadJson}::jsonb,
        ${reconciledAtIso}::timestamptz,
        NOW()
      )
    ON CONFLICT (exchange_connection_id, symbol)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      local_net_qty = EXCLUDED.local_net_qty,
      exchange_net_qty = EXCLUDED.exchange_net_qty,
      qty_diff = EXCLUDED.qty_diff,
      mismatch = EXCLUDED.mismatch,
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      raw_payload = EXCLUDED.raw_payload,
      reconciled_at = EXCLUDED.reconciled_at,
      updated_at = NOW()
  `);
}

async function getPreviousReconciliationSnapshot(params: {
  exchangeConnectionId: string;
  symbol: string;
}): Promise<{
  status: string | null;
  localNetQty: number;
  exchangeNetQty: number;
  rawPayload: Record<string, unknown> | null;
} | null> {
  if (!db) return null;
  const [row] = await db
    .select({
      status: livePositionReconciliations.status,
      localNetQty: livePositionReconciliations.localNetQty,
      exchangeNetQty: livePositionReconciliations.exchangeNetQty,
      rawPayload: livePositionReconciliations.rawPayload,
    })
    .from(livePositionReconciliations)
    .where(
      and(
        eq(livePositionReconciliations.exchangeConnectionId, params.exchangeConnectionId),
        eq(livePositionReconciliations.symbol, params.symbol),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    status: row.status ?? null,
    localNetQty: num(String(row.localNetQty ?? "0")),
    exchangeNetQty: num(String(row.exchangeNetQty ?? "0")),
    rawPayload:
      row.rawPayload && typeof row.rawPayload === "object"
        ? (row.rawPayload as Record<string, unknown>)
        : null,
  };
}

async function resolveRunIdForSubscription(subscriptionId: string): Promise<string | null> {
  if (!db) return null;
  const [run] = await db
    .select({ runId: userStrategyRuns.id })
    .from(userStrategyRuns)
    .where(eq(userStrategyRuns.subscriptionId, subscriptionId))
    .orderBy(desc(userStrategyRuns.updatedAt))
    .limit(1);
  return run?.runId ?? null;
}

async function autoFlattenLocalPosition(params: {
  userId: string;
  exchangeConnectionId: string;
  symbol: string;
  oldQty: number;
}): Promise<void> {
  if (!db) return;
  const [row] = await db
    .select({
      id: botPositions.id,
      subscriptionId: botPositions.subscriptionId,
      netQtyRaw: botPositions.netQuantity,
      metadata: botPositions.metadata,
    })
    .from(botPositions)
    .where(
      and(
        eq(botPositions.userId, params.userId),
        eq(botPositions.exchangeConnectionId, params.exchangeConnectionId),
        eq(botPositions.symbol, params.symbol),
      ),
    )
    .limit(1);
  if (!row) return;

  const currentQty = num(String(row.netQtyRaw ?? "0"));
  if (Math.abs(currentQty) <= QTY_EPS) return;

  const runId = await resolveRunIdForSubscription(row.subscriptionId);
  const prevMetadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const flattenedAtIso = new Date().toISOString();
  await db
    .update(botPositions)
    .set({
      netQuantity: "0",
      averageEntryPrice: null,
      metadata: {
        ...prevMetadata,
        reconciliation_auto_flattened_at: flattenedAtIso,
        reconciliation_auto_flattened_old_qty: String(currentQty),
      },
      updatedAt: new Date(),
    })
    .where(eq(botPositions.id, row.id));

  tradingLog("warn", "position_auto_flattened_from_reconciliation", {
    userId: params.userId,
    runId,
    symbol: params.symbol,
    oldQty: currentQty,
    newQty: 0,
    exchangeConnectionId: params.exchangeConnectionId,
  });
}

async function reconcileOneConnection(
  connection: ReconcileTargetConnection,
  reconciledAt: Date,
): Promise<{ ok: true; symbols: number } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: "no_database" };

  const localRows = await db
    .select({
      symbol: botPositions.symbol,
      netQtyRaw: botPositions.netQuantity,
    })
    .from(botPositions)
    .where(
      and(
        eq(botPositions.exchangeConnectionId, connection.id),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > ${QTY_EPS}`,
      ),
    );
  const localBySymbol = new Map<string, number>();
  for (const row of localRows) {
    localBySymbol.set(row.symbol.trim().toUpperCase(), num(row.netQtyRaw));
  }

  const adapterRes = await resolveExchangeTradingAdapter({
    provider: connection.provider,
    apiKeyCiphertext: connection.apiKeyCiphertext,
    apiSecretCiphertext: connection.apiSecretCiphertext,
  });
  if (!adapterRes.ok) {
    const symbols = localBySymbol.size > 0 ? [...localBySymbol.keys()] : ["*"];
    for (const symbol of symbols) {
      await upsertSnapshot({
        userId: connection.userId,
        exchangeConnectionId: connection.id,
        symbol,
        localNetQty: localBySymbol.get(symbol) ?? 0,
        exchangeNetQty: 0,
        mismatch: true,
        status: "error",
        errorMessage: adapterRes.error,
        rawPayload: null,
        reconciledAt,
      });
    }
    return { ok: false, error: adapterRes.error };
  }

  const positionsRes = await adapterRes.adapter.fetchOpenPositions?.({
    symbols: [...localBySymbol.keys()],
  });
  if (!positionsRes) {
    const err = "adapter_does_not_support_fetch_open_positions";
    const symbols = localBySymbol.size > 0 ? [...localBySymbol.keys()] : ["*"];
    for (const symbol of symbols) {
      await upsertSnapshot({
        userId: connection.userId,
        exchangeConnectionId: connection.id,
        symbol,
        localNetQty: localBySymbol.get(symbol) ?? 0,
        exchangeNetQty: 0,
        mismatch: true,
        status: "error",
        errorMessage: err,
        rawPayload: null,
        reconciledAt,
      });
    }
    return { ok: false, error: err };
  }
  if (!positionsRes.ok) {
    const symbols = localBySymbol.size > 0 ? [...localBySymbol.keys()] : ["*"];
    for (const symbol of symbols) {
      await upsertSnapshot({
        userId: connection.userId,
        exchangeConnectionId: connection.id,
        symbol,
        localNetQty: localBySymbol.get(symbol) ?? 0,
        exchangeNetQty: 0,
        mismatch: true,
        status: "error",
        errorMessage: positionsRes.error,
        rawPayload: positionsRes.raw ?? null,
        reconciledAt,
      });
    }
    return { ok: false, error: positionsRes.error };
  }

  const exchangeBySymbol = new Map<string, number>();
  for (const p of positionsRes.positions) {
    const symbol = p.symbol.trim().toUpperCase();
    if (!symbol) continue;
    exchangeBySymbol.set(symbol, num(p.netQty));
  }

  const symbols = new Set<string>([
    ...localBySymbol.keys(),
    ...exchangeBySymbol.keys(),
  ]);
  for (const symbol of symbols) {
    const localQty = localBySymbol.get(symbol) ?? 0;
    const exchangeQty = exchangeBySymbol.get(symbol) ?? 0;
    const mismatch = Math.abs(localQty - exchangeQty) > QTY_EPS;
    const prev = await getPreviousReconciliationSnapshot({
      exchangeConnectionId: connection.id,
      symbol,
    });
    const prevStreakRaw =
      prev?.rawPayload &&
      typeof prev.rawPayload.zero_exchange_confirmations === "number"
        ? prev.rawPayload.zero_exchange_confirmations
        : 0;
    const prevStreak = Number.isFinite(prevStreakRaw) ? Math.max(0, Math.floor(prevStreakRaw)) : 0;
    const confirmsExchangeZeroNow = Math.abs(exchangeQty) <= QTY_EPS && Math.abs(localQty) > QTY_EPS;
    const zeroExchangeConfirmations = confirmsExchangeZeroNow ? prevStreak + 1 : 0;

    if (
      confirmsExchangeZeroNow &&
      zeroExchangeConfirmations >= AUTO_FLATTEN_CONFIRMATIONS_REQUIRED
    ) {
      await autoFlattenLocalPosition({
        userId: connection.userId,
        exchangeConnectionId: connection.id,
        symbol,
        oldQty: localQty,
      });
      localBySymbol.set(symbol, 0);
    }

    const localQtyAfterFlatten = localBySymbol.get(symbol) ?? localQty;
    const mismatchAfterFlatten = Math.abs(localQtyAfterFlatten - exchangeQty) > QTY_EPS;
    await upsertSnapshot({
      userId: connection.userId,
      exchangeConnectionId: connection.id,
      symbol,
      localNetQty: localQtyAfterFlatten,
      exchangeNetQty: exchangeQty,
      mismatch: mismatchAfterFlatten,
      status: "ok",
      errorMessage: null,
      rawPayload: mismatchAfterFlatten
        ? {
            local_net_qty: localQtyAfterFlatten,
            exchange_net_qty: exchangeQty,
            zero_exchange_confirmations: zeroExchangeConfirmations,
            auto_flatten_confirmations_required:
              AUTO_FLATTEN_CONFIRMATIONS_REQUIRED,
          }
        : null,
      reconciledAt,
    });
  }
  return { ok: true, symbols: symbols.size };
}

export async function runLivePositionReconciliationOnce(): Promise<{
  ok: true;
  checkedConnections: number;
  failedConnections: number;
  snapshotsWritten: number;
  reconciledAt: string;
}> {
  if (!db) {
    return {
      ok: true,
      checkedConnections: 0,
      failedConnections: 0,
      snapshotsWritten: 0,
      reconciledAt: new Date().toISOString(),
    };
  }
  const reconciledAt = new Date();
  const connections = await db
    .select({
      id: exchangeConnections.id,
      userId: exchangeConnections.userId,
      provider: exchangeConnections.provider,
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.provider, "delta_india"),
        eq(exchangeConnections.status, "active"),
        isNull(exchangeConnections.deletedAt),
      ),
    );

  let failedConnections = 0;
  let snapshotsWritten = 0;
  for (const conn of connections) {
    const out = await reconcileOneConnection(conn, reconciledAt);
    if (!out.ok) {
      failedConnections += 1;
      tradingLog("warn", "position_reconciliation_connection_failed", {
        exchangeConnectionId: conn.id,
        userId: conn.userId,
        error: out.error,
      });
    } else {
      snapshotsWritten += out.symbols;
    }
  }

  tradingLog("info", "position_reconciliation_completed", {
    checkedConnections: connections.length,
    failedConnections,
    snapshotsWritten,
    reconciledAt: reconciledAt.toISOString(),
  });

  return {
    ok: true,
    checkedConnections: connections.length,
    failedConnections,
    snapshotsWritten,
    reconciledAt: reconciledAt.toISOString(),
  };
}
