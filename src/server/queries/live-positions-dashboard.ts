import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  botPositions,
  exchangeConnections,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
} from "@/server/db/schema";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";

const QTY_EPS = 1e-8;

export type LiveOpenPositionRow = {
  key: string;
  userId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  runId: string;
  subscriptionId: string;
  exchangeConnectionId: string;
  /** Saved Delta profile label when present. */
  venueLabel: string | null;
  symbol: string;
  side: "long" | "short";
  /** Signed contracts (lots). */
  netQty: number;
  displayQty: number;
  avgEntryPrice: number | null;
  markPrice: number | null;
  unrealizedPnlUsd: number;
  openedAt: string | null;
};

export type AdminLiveOpenPositionRow = LiveOpenPositionRow & {
  userLabel: string;
};

function num(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function legSide(netQty: number): "long" | "short" {
  return netQty > 0 ? "long" : "short";
}

function userDisplayName(email: string, name: string | null): string {
  const n = name?.trim();
  if (n) return n;
  return email;
}

async function fetchMarksForSymbols(symbols: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, number>();
  await Promise.all(
    uniq.map(async (sym) => {
      const px = await fetchDeltaIndiaTickerMarkPrice({ symbol: sym });
      if (px != null && px > 0) out.set(sym, px);
    }),
  );
  return out;
}

function unrealizedFromMark(
  netQty: number,
  avgEntry: number | null,
  mark: number | null,
): number | null {
  if (
    mark == null ||
    avgEntry == null ||
    !Number.isFinite(netQty) ||
    !Number.isFinite(avgEntry) ||
    !Number.isFinite(mark) ||
    mark <= 0
  ) {
    return null;
  }
  return netQty * (mark - avgEntry);
}

export async function getUserLiveOpenPositions(userId: string): Promise<LiveOpenPositionRow[]> {
  if (!db) return [];

  const now = new Date();

  const rows = await db
    .select({
      positionId: botPositions.id,
      userId: botPositions.userId,
      strategyId: botPositions.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      runId: userStrategyRuns.id,
      subscriptionId: botPositions.subscriptionId,
      exchangeConnectionId: botPositions.exchangeConnectionId,
      venueLabel: exchangeConnections.accountLabel,
      symbol: botPositions.symbol,
      netQtyRaw: botPositions.netQuantity,
      avgEntryRaw: botPositions.averageEntryPrice,
      unrealizedDb: botPositions.unrealizedPnlInr,
      openedAt: botPositions.openedAt,
    })
    .from(botPositions)
    .innerJoin(users, eq(botPositions.userId, users.id))
    .innerJoin(strategies, eq(botPositions.strategyId, strategies.id))
    .innerJoin(
      userStrategySubscriptions,
      and(
        eq(botPositions.subscriptionId, userStrategySubscriptions.id),
        eq(userStrategySubscriptions.userId, botPositions.userId),
      ),
    )
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      exchangeConnections,
      eq(botPositions.exchangeConnectionId, exchangeConnections.id),
    )
    .where(
      and(
        eq(botPositions.userId, userId),
        eq(users.approvalStatus, "approved"),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > ${QTY_EPS}`,
        eq(userStrategyRuns.status, "active"),
        eq(userStrategySubscriptions.status, "active"),
        gt(userStrategySubscriptions.accessValidUntil, now),
        isNull(userStrategySubscriptions.deletedAt),
        isNull(strategies.deletedAt),
        eq(strategies.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(desc(botPositions.updatedAt));

  const syms = rows.map((r) => r.symbol).filter(Boolean);
  const markBySymbol = await fetchMarksForSymbols(syms);

  return rows.map((r) => {
    const netQty = num(r.netQtyRaw);
    const avgEntry = r.avgEntryRaw != null ? num(String(r.avgEntryRaw)) : null;
    const mark = markBySymbol.get(r.symbol.trim()) ?? null;
    const fromMark = unrealizedFromMark(netQty, avgEntry, mark);
    const unrealizedPnlUsd =
      fromMark != null && Number.isFinite(fromMark)
        ? fromMark
        : num(String(r.unrealizedDb ?? "0"));

    return {
      key: `live:${r.positionId}`,
      userId: r.userId,
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      strategySlug: r.strategySlug,
      runId: r.runId,
      subscriptionId: r.subscriptionId,
      exchangeConnectionId: r.exchangeConnectionId,
      venueLabel: r.venueLabel?.trim() || null,
      symbol: r.symbol,
      side: legSide(netQty),
      netQty,
      displayQty: Math.abs(netQty),
      avgEntryPrice: avgEntry != null && avgEntry > 0 ? avgEntry : null,
      markPrice: mark,
      unrealizedPnlUsd,
      openedAt: r.openedAt?.toISOString() ?? null,
    };
  });
}

export async function getAdminLiveOpenPositions(): Promise<AdminLiveOpenPositionRow[]> {
  if (!db) return [];

  const now = new Date();

  const rows = await db
    .select({
      positionId: botPositions.id,
      userId: botPositions.userId,
      userEmail: users.email,
      userName: users.name,
      strategyId: botPositions.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      runId: userStrategyRuns.id,
      subscriptionId: botPositions.subscriptionId,
      exchangeConnectionId: botPositions.exchangeConnectionId,
      venueLabel: exchangeConnections.accountLabel,
      symbol: botPositions.symbol,
      netQtyRaw: botPositions.netQuantity,
      avgEntryRaw: botPositions.averageEntryPrice,
      unrealizedDb: botPositions.unrealizedPnlInr,
      openedAt: botPositions.openedAt,
    })
    .from(botPositions)
    .innerJoin(users, eq(botPositions.userId, users.id))
    .innerJoin(strategies, eq(botPositions.strategyId, strategies.id))
    .innerJoin(
      userStrategySubscriptions,
      and(
        eq(botPositions.subscriptionId, userStrategySubscriptions.id),
        eq(userStrategySubscriptions.userId, botPositions.userId),
      ),
    )
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      exchangeConnections,
      eq(botPositions.exchangeConnectionId, exchangeConnections.id),
    )
    .where(
      and(
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > ${QTY_EPS}`,
        eq(userStrategyRuns.status, "active"),
        eq(userStrategySubscriptions.status, "active"),
        gt(userStrategySubscriptions.accessValidUntil, now),
        isNull(userStrategySubscriptions.deletedAt),
        isNull(strategies.deletedAt),
        eq(strategies.status, "active"),
        isNull(users.deletedAt),
        eq(users.approvalStatus, "approved"),
      ),
    )
    .orderBy(desc(botPositions.updatedAt));

  const syms = rows.map((r) => r.symbol).filter(Boolean);
  const markBySymbol = await fetchMarksForSymbols(syms);

  return rows.map((r) => {
    const netQty = num(r.netQtyRaw);
    const avgEntry = r.avgEntryRaw != null ? num(String(r.avgEntryRaw)) : null;
    const mark = markBySymbol.get(r.symbol.trim()) ?? null;
    const fromMark = unrealizedFromMark(netQty, avgEntry, mark);
    const unrealizedPnlUsd =
      fromMark != null && Number.isFinite(fromMark)
        ? fromMark
        : num(String(r.unrealizedDb ?? "0"));

    return {
      key: `live:${r.positionId}`,
      userId: r.userId,
      userLabel: userDisplayName(r.userEmail, r.userName),
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      strategySlug: r.strategySlug,
      runId: r.runId,
      subscriptionId: r.subscriptionId,
      exchangeConnectionId: r.exchangeConnectionId,
      venueLabel: r.venueLabel?.trim() || null,
      symbol: r.symbol,
      side: legSide(netQty),
      netQty,
      displayQty: Math.abs(netQty),
      avgEntryPrice: avgEntry != null && avgEntry > 0 ? avgEntry : null,
      markPrice: mark,
      unrealizedPnlUsd,
      openedAt: r.openedAt?.toISOString() ?? null,
    };
  });
}
