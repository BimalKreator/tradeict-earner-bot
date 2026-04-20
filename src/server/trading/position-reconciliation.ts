import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { botPositions, exchangeConnections, livePositionReconciliations } from "@/server/db/schema";

import { resolveExchangeTradingAdapter } from "./adapters/resolve-exchange-adapter";
import { tradingLog } from "./trading-log";

const QTY_EPS = 1e-8;

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
    await upsertSnapshot({
      userId: connection.userId,
      exchangeConnectionId: connection.id,
      symbol,
      localNetQty: localQty,
      exchangeNetQty: exchangeQty,
      mismatch,
      status: "ok",
      errorMessage: null,
      rawPayload: mismatch
        ? {
            local_net_qty: localQty,
            exchange_net_qty: exchangeQty,
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
