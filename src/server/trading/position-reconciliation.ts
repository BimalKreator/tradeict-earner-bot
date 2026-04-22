import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { isTrendProfitLockScalpingStrategySlug } from "@/lib/trend-profit-lock-config";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";

import { db } from "@/server/db";
import {
  botOrders,
  botPositions,
  exchangeConnections,
  livePositionReconciliations,
  strategies,
  userStrategyRuns,
} from "@/server/db/schema";

import { resolveExchangeTradingAdapter } from "./adapters/resolve-exchange-adapter";
import { tradingLog } from "./trading-log";

const QTY_EPS = 1e-8;
const AUTO_FLATTEN_CONFIRMATIONS_REQUIRED = Math.max(
  1,
  Number(process.env.POSITION_RECONCILIATION_AUTO_FLATTEN_CONFIRMATIONS ?? "2") || 2,
);

/** Do not auto-flatten local rows opened/updated within this window (Delta list may lag). */
const RECONCILIATION_OPEN_GRACE_MS = Math.max(
  0,
  Number(process.env.POSITION_RECONCILIATION_OPEN_GRACE_MS ?? "60000") || 60_000,
);

function positionWithinOpenGrace(
  meta: { openedAt: Date | null; updatedAt: Date | null } | undefined,
): boolean {
  if (!meta || RECONCILIATION_OPEN_GRACE_MS <= 0) return false;
  const ref = meta.openedAt ?? meta.updatedAt;
  if (!ref) return false;
  return Date.now() - ref.getTime() < RECONCILIATION_OPEN_GRACE_MS;
}

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

function distributeTplD2OpenStepQty(params: {
  openStates: { step: number; qty: number }[];
  exchangeAbsQty: number;
}): Map<number, number> {
  const out = new Map<number, number>();
  const states = [...params.openStates].sort((a, b) => a.step - b.step);
  const localSum = states.reduce((sum, s) => sum + s.qty, 0);
  if (params.exchangeAbsQty >= localSum - QTY_EPS) {
    for (const s of states) out.set(s.step, s.qty);
    return out;
  }
  let remaining = Math.max(0, params.exchangeAbsQty);
  for (const s of states) {
    const keep = Math.max(0, Math.min(s.qty, remaining));
    out.set(s.step, keep);
    remaining -= keep;
    if (remaining <= QTY_EPS) remaining = 0;
  }
  return out;
}

async function applyTplD2PartialSync(params: {
  userId: string;
  exchangeConnectionId: string;
  symbol: string;
  exchangeQty: number;
}): Promise<void> {
  if (!db) return;
  const [row] = await db
    .select({
      runId: userStrategyRuns.id,
      strategyId: userStrategyRuns.strategyId,
      strategySlug: strategies.slug,
      runSettingsJson: userStrategyRuns.runSettingsJson,
    })
    .from(botPositions)
    .innerJoin(
      userStrategyRuns,
      and(
        eq(botPositions.subscriptionId, userStrategyRuns.subscriptionId),
        eq(botPositions.strategyId, userStrategyRuns.strategyId),
      ),
    )
    .innerJoin(strategies, eq(userStrategyRuns.strategyId, strategies.id))
    .where(
      and(
        eq(botPositions.userId, params.userId),
        eq(botPositions.exchangeConnectionId, params.exchangeConnectionId),
        eq(botPositions.symbol, params.symbol),
        eq(userStrategyRuns.secondaryExchangeConnectionId, params.exchangeConnectionId),
        eq(userStrategyRuns.status, "active"),
      ),
    )
    .orderBy(desc(userStrategyRuns.updatedAt))
    .limit(1);
  if (!row || !isTrendProfitLockScalpingStrategySlug(row.strategySlug)) return;

  const parsed = parseUserStrategyRunSettingsJson(row.runSettingsJson);
  const runtime = parsed.trendProfitLockRuntime;
  if (!runtime?.d2StepsState) return;
  const openStates = Object.values(runtime.d2StepsState)
    .filter((s) => s.status === "open" && Number.isFinite(s.qty) && s.qty > 0)
    .map((s) => ({ step: s.step, qty: s.qty }));
  if (openStates.length === 0) return;
  const localSum = openStates.reduce((sum, s) => sum + s.qty, 0);
  const exchangeAbs = Math.abs(params.exchangeQty);
  if (!(exchangeAbs + QTY_EPS < localSum)) return;

  const allocation = distributeTplD2OpenStepQty({
    openStates,
    exchangeAbsQty: exchangeAbs,
  });
  const nextD2StepsState = { ...runtime.d2StepsState };
  const before = openStates.map((s) => ({ step: s.step, qty: s.qty }));
  const after: { step: number; qty: number }[] = [];
  const nextTriggered = new Set(runtime.d2TriggeredSteps ?? []);
  for (const s of openStates) {
    const keepQty = allocation.get(s.step) ?? 0;
    if (keepQty > QTY_EPS) {
      nextD2StepsState[String(s.step)] = {
        ...nextD2StepsState[String(s.step)]!,
        qty: keepQty,
      };
      after.push({ step: s.step, qty: keepQty });
      continue;
    }
    delete nextD2StepsState[String(s.step)];
    nextTriggered.delete(s.step);
    after.push({ step: s.step, qty: 0 });
  }
  const nextRunSettingsJson = {
    ...(row.runSettingsJson as Record<string, unknown>),
    trendProfitLockRuntime: {
      ...runtime,
      d2StepsState: nextD2StepsState,
      d2TriggeredSteps: [...nextTriggered].sort((a, b) => a - b),
    },
  };
  await db
    .update(userStrategyRuns)
    .set({
      runSettingsJson: nextRunSettingsJson,
      updatedAt: new Date(),
    })
    .where(eq(userStrategyRuns.id, row.runId));

  tradingLog("warn", "tpl_d2_partial_sync_applied", {
    event: "tpl_d2_partial_sync_applied",
    runId: row.runId,
    strategyId: row.strategyId,
    userId: params.userId,
    exchangeConnectionId: params.exchangeConnectionId,
    symbol: params.symbol,
    exchangeAbsQty: exchangeAbs,
    localD2QtyBefore: localSum,
    localD2QtyAfter: after.reduce((sum, s) => sum + s.qty, 0),
    before,
    after,
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
      openedAt: botPositions.openedAt,
      updatedAt: botPositions.updatedAt,
    })
    .from(botPositions)
    .where(
      and(
        eq(botPositions.exchangeConnectionId, connection.id),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > ${QTY_EPS}`,
      ),
    );
  const localBySymbol = new Map<string, number>();
  const localGraceBySymbol = new Map<
    string,
    { openedAt: Date | null; updatedAt: Date | null }
  >();
  for (const row of localRows) {
    const sym = row.symbol.trim().toUpperCase();
    localBySymbol.set(sym, num(row.netQtyRaw));
    localGraceBySymbol.set(sym, {
      openedAt: row.openedAt ?? null,
      updatedAt: row.updatedAt ?? null,
    });
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
    if (mismatch && localBySymbol.has(symbol)) {
      await db
        .update(botPositions)
        .set({
          netQuantity: toFixedQty(exchangeQty),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(botPositions.userId, connection.userId),
            eq(botPositions.exchangeConnectionId, connection.id),
            eq(botPositions.symbol, symbol),
          ),
        );
      tradingLog("warn", "position_reconciliation_force_synced_local_qty", {
        event: "position_reconciliation_force_synced_local_qty",
        exchangeConnectionId: connection.id,
        userId: connection.userId,
        symbol,
        localQtyBefore: localQty,
        exchangeQty,
      });
      localBySymbol.set(symbol, exchangeQty);
      await applyTplD2PartialSync({
        userId: connection.userId,
        exchangeConnectionId: connection.id,
        symbol,
        exchangeQty,
      });
    }
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
    const inOpenGrace = positionWithinOpenGrace(localGraceBySymbol.get(symbol));
    const confirmsExchangeZeroNow =
      !inOpenGrace &&
      Math.abs(exchangeQty) <= QTY_EPS &&
      Math.abs(localQty) > QTY_EPS;
    const zeroExchangeConfirmations = confirmsExchangeZeroNow ? prevStreak + 1 : 0;

    if (
      confirmsExchangeZeroNow &&
      zeroExchangeConfirmations >= AUTO_FLATTEN_CONFIRMATIONS_REQUIRED
    ) {
      const rawRoot =
        positionsRes.ok && positionsRes.raw && typeof positionsRes.raw === "object"
          ? (positionsRes.raw as Record<string, unknown>)
          : null;
      const rawForSymbol = rawRoot ? rawRoot[symbol] : null;
      const payloadStr =
        rawForSymbol != null
          ? JSON.stringify(rawForSymbol).slice(0, 12_000)
          : rawRoot != null
            ? JSON.stringify(rawRoot).slice(0, 12_000)
            : null;
      tradingLog("warn", "position_reconciliation_auto_flattening_local", {
        event: "position_reconciliation_auto_flattening_local",
        exchangeConnectionId: connection.id,
        userId: connection.userId,
        symbol,
        localQty,
        exchangeQtyParsedFromAdapter: exchangeQty,
        zeroExchangeConfirmations,
        confirmationsRequired: AUTO_FLATTEN_CONFIRMATIONS_REQUIRED,
        deltaPositionsEndpointPayload: payloadStr,
      });
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
            open_grace_ms: RECONCILIATION_OPEN_GRACE_MS,
            open_grace_skipped_zero_streak: inOpenGrace,
          }
        : null,
      reconciledAt,
    });
  }
  return { ok: true, symbols: symbols.size };
}

async function sweepTplOrphanProtectiveOrders(
  reconciledAt: Date,
): Promise<{ checked: number; cancelled: number; failed: number }> {
  if (!db) return { checked: 0, cancelled: 0, failed: 0 };

  const candidates = await db
    .select({
      botOrderId: botOrders.id,
      runId: botOrders.runId,
      subscriptionId: botOrders.subscriptionId,
      strategyId: botOrders.strategyId,
      symbol: botOrders.symbol,
      exchangeConnectionId: botOrders.exchangeConnectionId,
      externalOrderId: botOrders.externalOrderId,
      status: botOrders.status,
      userId: botOrders.userId,
      strategySlug: strategies.slug,
      provider: exchangeConnections.provider,
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
    })
    .from(botOrders)
    .innerJoin(strategies, eq(botOrders.strategyId, strategies.id))
    .innerJoin(exchangeConnections, eq(botOrders.exchangeConnectionId, exchangeConnections.id))
    .where(
      and(
        sql`lower(${strategies.slug}) like '%trend-profit-lock%'`,
        inArray(botOrders.status, ["draft", "queued", "submitting", "open", "partial_fill"]),
        sql`${botOrders.externalOrderId} is not null and length(trim(${botOrders.externalOrderId})) > 0`,
      ),
    )
    .orderBy(desc(botOrders.updatedAt))
    .limit(250);

  let checked = 0;
  let cancelled = 0;
  let failed = 0;

  for (const row of candidates) {
    checked += 1;
    const [openPos] = await db
      .select({ id: botPositions.id })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.subscriptionId, row.subscriptionId),
          eq(botPositions.strategyId, row.strategyId),
          eq(botPositions.exchangeConnectionId, row.exchangeConnectionId),
          eq(botPositions.symbol, row.symbol),
          sql`abs(cast(${botPositions.netQuantity} as numeric)) > ${QTY_EPS}`,
        ),
      )
      .limit(1);
    if (openPos) continue;

    const adapterRes = await resolveExchangeTradingAdapter({
      provider: row.provider,
      apiKeyCiphertext: row.apiKeyCiphertext,
      apiSecretCiphertext: row.apiSecretCiphertext,
    });
    if (!adapterRes.ok || !adapterRes.adapter.cancelOrderByExternalId) {
      failed += 1;
      tradingLog("warn", "position_reconciliation_tpl_orphan_cancel_skipped_adapter", {
        reconciledAt: reconciledAt.toISOString(),
        botOrderId: row.botOrderId,
        runId: row.runId,
        strategyId: row.strategyId,
        strategySlug: row.strategySlug,
        symbol: row.symbol,
        exchangeConnectionId: row.exchangeConnectionId,
        error: adapterRes.ok ? "cancelOrderByExternalId_not_supported" : adapterRes.error,
      });
      continue;
    }

    try {
      const out = await adapterRes.adapter.cancelOrderByExternalId(String(row.externalOrderId));
      if (out.ok) {
        cancelled += out.cancelled ? 1 : 0;
        await db
          .update(botOrders)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
            venueOrderState: out.cancelled ? "cancelled" : row.status,
          })
          .where(eq(botOrders.id, row.botOrderId));
        tradingLog("warn", "position_reconciliation_tpl_orphan_cancelled", {
          reconciledAt: reconciledAt.toISOString(),
          botOrderId: row.botOrderId,
          runId: row.runId,
          strategyId: row.strategyId,
          strategySlug: row.strategySlug,
          symbol: row.symbol,
          exchangeConnectionId: row.exchangeConnectionId,
          externalOrderId: row.externalOrderId,
          cancelled: out.cancelled,
        });
      } else {
        failed += 1;
        tradingLog("warn", "position_reconciliation_tpl_orphan_cancel_failed", {
          reconciledAt: reconciledAt.toISOString(),
          botOrderId: row.botOrderId,
          runId: row.runId,
          strategyId: row.strategyId,
          strategySlug: row.strategySlug,
          symbol: row.symbol,
          exchangeConnectionId: row.exchangeConnectionId,
          externalOrderId: row.externalOrderId,
          error: out.error,
        });
      }
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("warn", "position_reconciliation_tpl_orphan_cancel_exception", {
        reconciledAt: reconciledAt.toISOString(),
        botOrderId: row.botOrderId,
        runId: row.runId,
        strategyId: row.strategyId,
        strategySlug: row.strategySlug,
        symbol: row.symbol,
        exchangeConnectionId: row.exchangeConnectionId,
        externalOrderId: row.externalOrderId,
        error: msg.slice(0, 400),
      });
    }
  }

  return { checked, cancelled, failed };
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

  const orphanSweep = await sweepTplOrphanProtectiveOrders(reconciledAt);

  tradingLog("info", "position_reconciliation_completed", {
    checkedConnections: connections.length,
    failedConnections,
    snapshotsWritten,
    orphanTplOrdersChecked: orphanSweep.checked,
    orphanTplOrdersCancelled: orphanSweep.cancelled,
    orphanTplOrdersFailed: orphanSweep.failed,
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
