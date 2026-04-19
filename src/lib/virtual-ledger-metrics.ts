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
 * Hedge-scalping: D2 clips use `hs_d2_*`; D1 uses `hs_d1_*`. Manual market closes from the UI
 * use `manual_close_virtual_<runId>_<D1|D2>_...` and must map to the same account bucket.
 */
export function classifyHedgeScalpingVirtualDualAccount(order: {
  correlationId: string | null;
}): AccountKey {
  const cid = (order.correlationId ?? "").toLowerCase();
  if (cid.startsWith("hs_d2_")) return "secondary";
  if (cid.startsWith("hs_d1_")) return "primary";
  const manual = /manual_close_virtual_[0-9a-f-]+_(d1|d2)_/i.exec(cid);
  if (manual) {
    return manual[1]!.toLowerCase() === "d2" ? "secondary" : "primary";
  }
  return "primary";
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
