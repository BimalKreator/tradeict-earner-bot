/**
 * Shared FIFO-style position math for virtual bot orders (and live bot orders with the same shape).
 */

export type LedgerOrderRow = {
  symbol: string;
  side: string;
  quantity: string;
  fillPrice: string | null;
  filledQty?: string | null;
  status: string;
  correlationId: string | null;
  createdAt: Date;
};

export type AccountKey = "primary" | "secondary";

export function num(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function isFilledOrder(status: string): boolean {
  return status === "filled" || status === "partial_fill";
}

/**
 * Delta-2 (hedge) orders: live/initial use `..._d2_...` in the correlation id.
 * Virtual follow-up clips from `trend-arb-poll` use `ta_trendarb_<strategyId>_v_<runId>_s<step>_<nonce>`
 * (no `_d2_` substring) — those must still classify as secondary for ledger/dashboard parity.
 */
export function isTrendArbSecondaryCorrelationId(
  correlationId: string | null | undefined,
): boolean {
  const cid = (correlationId ?? "").toLowerCase();
  if (cid.includes("delta2")) return true;
  if (cid.includes("_d2_")) return true;
  if (cid.startsWith("ta_trendarb_") && /_v_.+?_s\d+_/i.test(cid)) return true;
  return false;
}

export function classifyTrendArbAccount(order: { correlationId: string | null }): AccountKey {
  return isTrendArbSecondaryCorrelationId(order.correlationId) ? "secondary" : "primary";
}

export type LedgerDerivedMetrics = {
  realizedPnlUsd: number;
  /** Unrealized using `markPrice` when set; otherwise last fill as mark (legacy). */
  unrealizedPnlUsd: number;
  openNetQty: number;
  openSymbol: string | null;
  avgEntryPrice: number | null;
};

/**
 * Replays filled orders in time order; optional `markPrice` for live unrealized.
 */
export function deriveLedgerMetrics(
  orders: LedgerOrderRow[],
  markPrice: number | null,
): LedgerDerivedMetrics {
  let q = 0;
  let avg: number | null = null;
  let realized = 0;
  let latestMark: number | null = null;
  let openSymbol: string | null = null;

  const ordered = [...orders]
    .filter((o) => isFilledOrder(o.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const o of ordered) {
    const qty = num(o.quantity);
    const fill = o.fillPrice != null ? num(o.fillPrice) : 0;
    if (qty <= 0 || fill <= 0) continue;
    latestMark = fill;

    const delta = o.side === "buy" ? qty : -qty;
    if (q === 0) {
      q = delta;
      avg = fill;
      openSymbol = o.symbol;
      continue;
    }

    const sameDirection = Math.sign(q) === Math.sign(delta);
    if (sameDirection) {
      const oldAbs = Math.abs(q);
      const addAbs = Math.abs(delta);
      const newAbs = oldAbs + addAbs;
      avg = avg == null ? fill : (oldAbs * avg + addAbs * fill) / newAbs;
      q += delta;
      openSymbol = o.symbol;
      continue;
    }

    const closeAbs = Math.min(Math.abs(q), Math.abs(delta));
    const entry = avg ?? fill;
    realized += closeAbs * Math.sign(q) * (fill - entry);
    q += delta;
    if (Math.abs(q) < 1e-8) {
      q = 0;
      avg = null;
      openSymbol = null;
    } else {
      openSymbol = o.symbol;
    }
  }

  const mark = markPrice != null && Number.isFinite(markPrice) && markPrice > 0 ? markPrice : latestMark;
  const unrealized =
    q !== 0 && avg != null && mark != null && Number.isFinite(mark) ? q * (mark - avg) : 0;

  return {
    realizedPnlUsd: realized,
    unrealizedPnlUsd: unrealized,
    openNetQty: q,
    openSymbol,
    avgEntryPrice: avg,
  };
}

export function isTrendArbSlug(slug: string): boolean {
  return slug.trim().toLowerCase().includes("trend-arb");
}
