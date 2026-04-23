import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { db } from "@/server/db";
import { botPositions } from "@/server/db/schema";

import { tradingLog } from "./trading-log";

const QTY_EPS = 1e-8;

/**
 * For a single flat position row, recompute notional entry price from the prior
 * state, a signed size delta, and the fill (venue) price. Matches: open from
 * flat, add, partial close, full close, and one-step reversal.
 */
function computeNextAverageEntryPriceForDeltaFill(params: {
  oldNet: number;
  oldAvg: number | null;
  delta: number;
  fill: number;
}): number | null {
  const { oldNet, oldAvg, delta, fill } = params;
  if (!(fill > 0) || !Number.isFinite(fill) || !Number.isFinite(delta)) {
    return oldAvg != null && oldAvg > 0 ? oldAvg : null;
  }
  const newNet = oldNet + delta;
  if (Math.abs(newNet) < QTY_EPS) {
    return null;
  }
  if (Math.abs(oldNet) < QTY_EPS) {
    return fill;
  }
  if (oldNet * delta > 0) {
    const aOld = Math.abs(oldNet);
    const aDelta = Math.abs(delta);
    const aNew = Math.abs(newNet);
    if (!(aNew > 0) || aOld * aDelta < 0) {
      return oldAvg != null && oldAvg > 0 ? oldAvg : fill;
    }
    const oa = oldAvg != null && oldAvg > 0 ? oldAvg : fill;
    return (aOld * oa + aDelta * fill) / aNew;
  }
  if (oldNet * newNet < 0) {
    return fill;
  }
  if (oldNet * newNet > 0) {
    if (oldAvg != null && oldAvg > 0) return oldAvg;
    return fill;
  }
  return oldAvg != null && oldAvg > 0 ? oldAvg : fill;
}

/**
 * 63-bit space for pg_advisory_xact_lock; stable per (sub, sym, ex).
 */
function xactPosLockId(subscriptionId: string, symbol: string, exchangeConnectionId: string): string {
  const h = createHash("sha256").update(`${subscriptionId}\n${symbol}\n${exchangeConnectionId}`).digest("hex");
  const n = parseInt(h.slice(0, 12), 16) % 9000000000000000;
  return String(n);
}

/**
 * Applies a fill to subscription-level position tracking per **exchange connection**
 * (multi-account: same symbol can have separate rows on Delta 1 vs Delta 2).
 * When `fillPrice` is set, keeps `average_entry_price` in sync with the venue so
 * live dashboards do not use a stale `bot_orders` window after flips.
 */
export async function bumpBotPositionNetQuantity(params: {
  userId: string;
  subscriptionId: string;
  strategyId: string;
  exchangeConnectionId: string;
  symbol: string;
  /** Signed delta (buy +, sell -) in position units. */
  deltaQty: string;
  /**
   * Venue fill price (same units as notional/contract for this product).
   * Without it, `net_quantity` is still updated but `average_entry_price` is not recalculated.
   */
  fillPrice?: string | null;
}): Promise<void> {
  if (!db) return;

  const delta = Number(String(params.deltaQty ?? "").trim());
  if (!Number.isFinite(delta) || Math.abs(delta) < QTY_EPS) {
    return;
  }

  const fillRaw = params.fillPrice != null ? String(params.fillPrice).trim() : "";
  const fill = fillRaw.length > 0 ? Number(fillRaw) : Number.NaN;
  const haveFill = Number.isFinite(fill) && fill > 0;

  await db.transaction(async (tx) => {
    const lockId = xactPosLockId(
      params.subscriptionId,
      params.symbol,
      params.exchangeConnectionId,
    );
    await tx.execute(sql`select pg_advisory_xact_lock(${lockId}::bigint)`);

    const [row] = await tx
      .select({
        id: botPositions.id,
        netQuantity: botPositions.netQuantity,
        averageEntryPrice: botPositions.averageEntryPrice,
        openedAt: botPositions.openedAt,
      })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.subscriptionId, params.subscriptionId),
          eq(botPositions.symbol, params.symbol),
          eq(botPositions.exchangeConnectionId, params.exchangeConnectionId),
        ),
      )
      .limit(1);

    const oldNet = row ? Number(String(row.netQuantity ?? 0)) : 0;
    const oldAvg =
      row?.averageEntryPrice != null
        ? Number(String(row.averageEntryPrice))
        : null;
    const newNet = oldNet + delta;
    const newAvg = haveFill
      ? computeNextAverageEntryPriceForDeltaFill({ oldNet, oldAvg, delta, fill })
      : row
        ? oldAvg
        : null;
    const now = new Date();

    if (!row) {
      const isFlat = Math.abs(newNet) < QTY_EPS;
      await tx.insert(botPositions).values({
        userId: params.userId,
        subscriptionId: params.subscriptionId,
        strategyId: params.strategyId,
        exchangeConnectionId: params.exchangeConnectionId,
        symbol: params.symbol,
        netQuantity: isFlat ? "0" : (Math.round(newNet * 1e8) / 1e8).toFixed(8),
        averageEntryPrice:
          haveFill && newAvg != null && newAvg > 0
            ? (Math.round(newAvg * 1e8) / 1e8).toFixed(8)
            : null,
        openedAt: isFlat ? null : now,
        updatedAt: now,
      });
    } else {
      const fromFlatToOpen = Math.abs(oldNet) < QTY_EPS && Math.abs(newNet) > QTY_EPS;
      const isFlat = Math.abs(newNet) < QTY_EPS;
      const openedAt = isFlat
        ? null
        : fromFlatToOpen || !row.openedAt
          ? now
          : row.openedAt;
      const nextAvgCol: { averageEntryPrice: string | null } | null = haveFill
        ? {
            averageEntryPrice:
              newAvg != null && newAvg > 0
                ? (Math.round(newAvg * 1e8) / 1e8).toFixed(8)
                : null,
          }
        : null;
      await tx
        .update(botPositions)
        .set({
          netQuantity: isFlat ? "0" : (Math.round(newNet * 1e8) / 1e8).toFixed(8),
          ...(nextAvgCol ?? {}),
          openedAt,
          updatedAt: now,
        })
        .where(eq(botPositions.id, row.id));
    }
  });

  tradingLog("info", "bot_position_bumped", {
    subscriptionId: params.subscriptionId,
    exchangeConnectionId: params.exchangeConnectionId,
    symbol: params.symbol,
    deltaQty: params.deltaQty,
    fillPrice: haveFill ? fill : null,
  });
}
