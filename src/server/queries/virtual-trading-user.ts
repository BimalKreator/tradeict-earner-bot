import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/server/db";
import {
  strategies,
  virtualBotOrders,
  virtualStrategyRuns,
} from "@/server/db/schema";

export type VirtualRunOverview = {
  runId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  status: string;
  leverage: string;
  virtualCapitalUsd: string;
  virtualAvailableCashUsd: string;
  virtualUsedMarginUsd: string;
  virtualRealizedPnlUsd: string;
  openNetQty: string;
  openSymbol: string | null;
};

export type VirtualOrderLedgerRow = {
  id: string;
  correlationId: string | null;
  symbol: string;
  side: string;
  quantity: string;
  fillPrice: string | null;
  filledQty: string | null;
  realizedPnlUsd: string | null;
  profitPercent: string | null;
  signalAction: string | null;
  status: string;
  createdAt: Date;
};

export async function listVirtualRunsOverviewForUser(
  userId: string,
): Promise<VirtualRunOverview[]> {
  if (!db) return [];

  const rows = await db
    .select({
      runId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      status: virtualStrategyRuns.status,
      leverage: virtualStrategyRuns.leverage,
      virtualCapitalUsd: virtualStrategyRuns.virtualCapitalUsd,
      virtualAvailableCashUsd: virtualStrategyRuns.virtualAvailableCashUsd,
      virtualUsedMarginUsd: virtualStrategyRuns.virtualUsedMarginUsd,
      virtualRealizedPnlUsd: virtualStrategyRuns.virtualRealizedPnlUsd,
      openNetQty: virtualStrategyRuns.openNetQty,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(eq(virtualStrategyRuns.userId, userId))
    .orderBy(desc(virtualStrategyRuns.updatedAt));

  return rows.map((r) => ({
    runId: r.runId,
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    strategySlug: r.strategySlug,
    status: r.status,
    leverage: String(r.leverage),
    virtualCapitalUsd: String(r.virtualCapitalUsd),
    virtualAvailableCashUsd: String(r.virtualAvailableCashUsd),
    virtualUsedMarginUsd: String(r.virtualUsedMarginUsd),
    virtualRealizedPnlUsd: String(r.virtualRealizedPnlUsd),
    openNetQty: String(r.openNetQty),
    openSymbol: r.openSymbol,
  }));
}

export async function listVirtualOrdersForRun(params: {
  userId: string;
  virtualRunId: string;
  limit?: number;
}): Promise<VirtualOrderLedgerRow[]> {
  if (!db) return [];
  const lim = Math.min(Math.max(params.limit ?? 80, 1), 200);

  const rows = await db
    .select({
      id: virtualBotOrders.id,
      correlationId: virtualBotOrders.correlationId,
      symbol: virtualBotOrders.symbol,
      side: virtualBotOrders.side,
      quantity: virtualBotOrders.quantity,
      fillPrice: virtualBotOrders.fillPrice,
      filledQty: virtualBotOrders.filledQty,
      realizedPnlUsd: virtualBotOrders.realizedPnlUsd,
      profitPercent: virtualBotOrders.profitPercent,
      signalAction: virtualBotOrders.signalAction,
      status: virtualBotOrders.status,
      createdAt: virtualBotOrders.createdAt,
    })
    .from(virtualBotOrders)
    .where(
      and(
        eq(virtualBotOrders.virtualRunId, params.virtualRunId),
        eq(virtualBotOrders.userId, params.userId),
      ),
    )
    .orderBy(desc(virtualBotOrders.createdAt))
    .limit(lim);

  return rows.map((r) => ({
    id: r.id,
    correlationId: r.correlationId,
    symbol: r.symbol,
    side: r.side,
    quantity: String(r.quantity),
    fillPrice: r.fillPrice != null ? String(r.fillPrice) : null,
    filledQty: r.filledQty != null ? String(r.filledQty) : null,
    realizedPnlUsd: r.realizedPnlUsd != null ? String(r.realizedPnlUsd) : null,
    profitPercent: r.profitPercent != null ? String(r.profitPercent) : null,
    signalAction: r.signalAction,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export async function loadVirtualRunForUser(params: {
  userId: string;
  virtualRunId: string;
}): Promise<VirtualRunOverview | null> {
  if (!db) return null;
  const [r] = await db
    .select({
      runId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      status: virtualStrategyRuns.status,
      leverage: virtualStrategyRuns.leverage,
      virtualCapitalUsd: virtualStrategyRuns.virtualCapitalUsd,
      virtualAvailableCashUsd: virtualStrategyRuns.virtualAvailableCashUsd,
      virtualUsedMarginUsd: virtualStrategyRuns.virtualUsedMarginUsd,
      virtualRealizedPnlUsd: virtualStrategyRuns.virtualRealizedPnlUsd,
      openNetQty: virtualStrategyRuns.openNetQty,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(
      and(
        eq(virtualStrategyRuns.id, params.virtualRunId),
        eq(virtualStrategyRuns.userId, params.userId),
      ),
    )
    .limit(1);

  if (!r) return null;
  return {
    runId: r.runId,
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    strategySlug: r.strategySlug,
    status: r.status,
    leverage: String(r.leverage),
    virtualCapitalUsd: String(r.virtualCapitalUsd),
    virtualAvailableCashUsd: String(r.virtualAvailableCashUsd),
    virtualUsedMarginUsd: String(r.virtualUsedMarginUsd),
    virtualRealizedPnlUsd: String(r.virtualRealizedPnlUsd),
    openNetQty: String(r.openNetQty),
    openSymbol: r.openSymbol,
  };
}

export async function assertStrategyEligibleForVirtualStart(
  strategyId: string,
): Promise<boolean> {
  if (!db) return false;
  const [r] = await db
    .select({ id: strategies.id })
    .from(strategies)
    .where(
      and(
        eq(strategies.id, strategyId),
        eq(strategies.visibility, "public"),
        eq(strategies.status, "active"),
        isNull(strategies.deletedAt),
      ),
    )
    .limit(1);
  return r != null;
}
