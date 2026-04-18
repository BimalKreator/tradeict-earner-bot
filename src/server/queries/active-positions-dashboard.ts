import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import {
  hedgeScalpingConfigSchema,
  isHedgeScalpingStrategySlug,
} from "@/lib/hedge-scalping-config";
import {
  deriveLedgerMetrics,
  isFilledOrder,
  num,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { db } from "@/server/db";
import {
  botOrders,
  botPositions,
  strategies,
  userStrategySubscriptions,
  users,
  userStrategyRuns,
  virtualBotOrders,
  virtualStrategyRuns,
} from "@/server/db/schema";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";

const QTY_EPS = 1e-8;

export type ActivePositionLeg = {
  key: string;
  mode: "virtual" | "real";
  userId: string;
  userLabel?: string;
  virtualRunId?: string;
  runId?: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  account: "D1" | "D2";
  symbol: string;
  side: "long" | "short";
  netQty: number;
  avgEntryPrice: number | null;
  displayNetQty: number;
  displayAvgEntryPrice: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  markPrice: number | null;
  qtyPctOfCapital: number | null;
  activeClipCount: number | null;
  /** One open D2 ladder clip row; unset = combined D2 leg. */
  d2LadderStep?: number | null;
  /** Approximate exit prices from saved strategy % (per leg / clip). */
  targetPrice?: number | null;
  stopLossPrice?: number | null;
};

export type UserClosedLegHistoryRow = {
  key: string;
  account: "D1" | "D2";
  symbol: string;
  side: "long" | "short";
  quantity: number;
  fillPrice: number | null;
  realizedPnlUsd: number;
  profitPercent: number | null;
  closedAt: string;
  qtyPctOfCapital: number | null;
  /** Hedge scalping: D2 exit row → ladder step from matching entry correlation. */
  d2LadderStep?: number | null;
};

export type UserActivePositionGroup = {
  runId: string;
  strategyName: string;
  strategySlug: string;
  isHedgeScalping: boolean;
  legs: ActivePositionLeg[];
  closedLegs: UserClosedLegHistoryRow[];
  activePnlUsd: number;
  realizedPnlUsd: number;
};

export type AdminLivePositionRow = ActivePositionLeg & {
  participatingUsers: string;
};

export type AdminStrategyStatusRow = {
  key: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  mode: "virtual" | "real";
  userLabel: string;
  participatingUsers: string;
};

export type AdminLiveTradeMonitorData = {
  rows: AdminLivePositionRow[];
  statusRows: AdminStrategyStatusRow[];
};

function userDisplayName(email: string, name: string | null): string {
  const n = name?.trim();
  if (n) return n;
  return email;
}

/** First name (or email local-part) for “Name (Virtual)” participation lists. */
function participationShortLabel(name: string | null, email: string): string {
  const n = name?.trim();
  if (n) {
    const first = n.split(/\s+/)[0];
    return first ?? n;
  }
  const local = email.split("@")[0]?.trim();
  return local && local.length > 0 ? local : email;
}

function legSide(netQty: number): "long" | "short" {
  return netQty > 0 ? "long" : "short";
}

function ordersToLedgerRows(
  rows: {
    symbol: string;
    side: string;
    quantity: string;
    fillPrice: string | null;
    status: string;
    correlationId: string | null;
    createdAt: Date;
  }[],
): LedgerOrderRow[] {
  return rows.map((r) => ({
    symbol: r.symbol,
    side: r.side,
    quantity: r.quantity,
    fillPrice: r.fillPrice,
    status: r.status,
    correlationId: r.correlationId,
    createdAt: r.createdAt,
  }));
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

/**
 * Keep only the current open-leg segment of a run/account ledger.
 * This prevents historical closed cycles from polluting current entry/qty display.
 */
function extractCurrentOpenLedgerWindow(orders: LedgerOrderRow[]): LedgerOrderRow[] {
  if (orders.length === 0) return [];
  let runningNet = 0;
  let lastFlatIdx = -1;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]!;
    if (!isFilledOrder(o.status)) continue;
    const qty = num(o.quantity);
    if (!(qty > 0)) continue;
    runningNet += o.side === "buy" ? qty : -qty;
    if (Math.abs(runningNet) <= QTY_EPS) {
      runningNet = 0;
      lastFlatIdx = i;
    }
  }
  if (Math.abs(runningNet) <= QTY_EPS) return [];
  return orders.slice(lastFlatIdx + 1);
}

function buildLegVirtual(params: {
  userId: string;
  virtualRunId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  account: "D1" | "D2";
  orders: LedgerOrderRow[];
  markBySymbol: Map<string, number>;
  /** Optional overrides for admin/user dashboards so virtual run state matches engine math. */
  overrideOpenNetQty?: number;
  overrideAvgEntryPrice?: number | null;
  overrideOpenSymbol?: string | null;
  /** Admin monitor: display name for participation column. */
  userLabel?: string;
  qtyPctOfCapital?: number | null;
  activeClipCount?: number | null;
  displayNetQtyOverride?: number | null;
  displayAvgEntryPriceOverride?: number | null;
  d2LadderStep?: number | null;
  /** Disambiguate multiple virtual legs per account (e.g. hedge-scalping D2 clips). */
  legKeySuffix?: string | null;
}): ActivePositionLeg | null {
  const openWindowOrders = extractCurrentOpenLedgerWindow(params.orders);
  const derivedSym =
    openWindowOrders.length > 0 ? openWindowOrders[openWindowOrders.length - 1]!.symbol : null;
  const sym = params.overrideOpenSymbol ?? derivedSym;
  const mark = sym ? params.markBySymbol.get(sym) ?? null : null;
  const dOpen = deriveLedgerMetrics(openWindowOrders, mark);
  const dAll = deriveLedgerMetrics(params.orders, mark);

  const netQty = params.overrideOpenNetQty ?? dOpen.openNetQty;
  const avgEntryPrice = params.overrideAvgEntryPrice ?? dOpen.avgEntryPrice;
  if (Math.abs(netQty) <= QTY_EPS) return null;

  const unrealizedPnlUsd =
    mark != null &&
    avgEntryPrice != null &&
    Number.isFinite(netQty) &&
    Number.isFinite(avgEntryPrice) &&
    mark > 0
      ? netQty * (mark - avgEntryPrice)
      : dOpen.unrealizedPnlUsd;

  const key =
    params.legKeySuffix && params.legKeySuffix.length > 0
      ? `v:${params.virtualRunId}:${params.account}:${params.legKeySuffix}`
      : `v:${params.virtualRunId}:${params.account}`;
  return {
    key,
    mode: "virtual",
    userId: params.userId,
    userLabel: params.userLabel,
    virtualRunId: params.virtualRunId,
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    strategySlug: params.strategySlug,
    account: params.account,
    symbol: sym ?? dOpen.openSymbol ?? "—",
    side: legSide(netQty),
    netQty,
    avgEntryPrice,
    displayNetQty: params.displayNetQtyOverride ?? netQty,
    displayAvgEntryPrice: params.displayAvgEntryPriceOverride ?? avgEntryPrice,
    realizedPnlUsd: dAll.realizedPnlUsd,
    unrealizedPnlUsd: unrealizedPnlUsd,
    markPrice: mark,
    qtyPctOfCapital: params.qtyPctOfCapital ?? null,
    activeClipCount: params.activeClipCount ?? null,
    d2LadderStep: params.d2LadderStep ?? undefined,
  };
}

function buildLegReal(params: {
  userId: string;
  userLabel: string;
  runId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  account: "D1" | "D2";
  orders: LedgerOrderRow[];
  markBySymbol: Map<string, number>;
  symbolHint: string;
  qtyPctOfCapital?: number | null;
  activeClipCount?: number | null;
}): ActivePositionLeg | null {
  const openWindowOrders = extractCurrentOpenLedgerWindow(params.orders);
  const mark = params.markBySymbol.get(params.symbolHint) ?? null;
  const dOpen = deriveLedgerMetrics(openWindowOrders, mark);
  const dAll = deriveLedgerMetrics(params.orders, mark);
  if (Math.abs(dOpen.openNetQty) <= QTY_EPS) return null;
  return {
    key: `r:${params.runId}:${params.account}:${params.symbolHint}`,
    mode: "real",
    userId: params.userId,
    userLabel: params.userLabel,
    runId: params.runId,
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    strategySlug: params.strategySlug,
    account: params.account,
    symbol: dOpen.openSymbol ?? params.symbolHint,
    side: legSide(dOpen.openNetQty),
    netQty: dOpen.openNetQty,
    avgEntryPrice: dOpen.avgEntryPrice,
    displayNetQty: dOpen.openNetQty,
    displayAvgEntryPrice: dOpen.avgEntryPrice,
    realizedPnlUsd: dAll.realizedPnlUsd,
    unrealizedPnlUsd: dOpen.unrealizedPnlUsd,
    markPrice: mark,
    qtyPctOfCapital: params.qtyPctOfCapital ?? null,
    activeClipCount: params.activeClipCount ?? null,
  };
}

type HedgeScalpingDisplaySettings = {
  d1QtyPctOfCapital: number;
  d2QtyPctOfCapital: number;
  d1TargetProfitPct: number;
  d1StopLossPct: number;
  d2TargetProfitPct: number;
  d2StopLossPct: number;
};

function parseHedgeScalpingDisplaySettings(
  settingsJson: Record<string, unknown> | null | undefined,
): HedgeScalpingDisplaySettings | null {
  const parsed = hedgeScalpingConfigSchema.safeParse(settingsJson ?? null);
  if (!parsed.success) return null;
  const d1 = parsed.data.delta1;
  const d2 = parsed.data.delta2;
  return {
    d1QtyPctOfCapital: d1.baseQtyPct,
    d2QtyPctOfCapital: d2.stepQtyPct,
    d1TargetProfitPct: Math.max(0, d1.targetProfitPct),
    d1StopLossPct: Math.max(0, d1.stopLossPct),
    d2TargetProfitPct: Math.max(0, d2.targetProfitPct),
    d2StopLossPct: Math.max(0, d2.stopLossPct),
  };
}

function parseHsD2EntryCorrelation(
  correlationId: string | null,
): { step: number; clipId: string } | null {
  const m = /^hs_d2_step(\d+)_([0-9a-f-]{36})$/i.exec(correlationId ?? "");
  if (!m) return null;
  const step = Number(m[1]);
  const clipId = m[2]!;
  if (!Number.isFinite(step) || step < 1) return null;
  return { step, clipId };
}

function parseHsD2ExitClipId(correlationId: string | null): string | null {
  const m = /^hs_d2_exit_([0-9a-f-]{36})_/i.exec(correlationId ?? "");
  return m?.[1] ?? null;
}

function hedgeScalpingD2StepFromClipId(
  clipId: string,
  orderRows: { correlationId: string | null }[],
): number | null {
  const id = clipId.toLowerCase();
  for (const row of orderRows) {
    const parsed = parseHsD2EntryCorrelation(row.correlationId);
    if (parsed && parsed.clipId.toLowerCase() === id) return parsed.step;
  }
  return null;
}

function computePctBasedExitPrices(params: {
  side: "long" | "short";
  entry: number | null;
  targetProfitPct: number;
  stopLossPct: number;
}): { targetPrice: number | null; stopLossPrice: number | null } {
  const { side, entry, targetProfitPct, stopLossPct } = params;
  if (entry == null || !(entry > 0) || !Number.isFinite(entry)) {
    return { targetPrice: null, stopLossPrice: null };
  }
  const tpFrac = Math.max(0, targetProfitPct) / 100;
  const slFrac = Math.max(0, stopLossPct) / 100;
  const targetPrice =
    tpFrac > 0 ? (side === "long" ? entry * (1 + tpFrac) : entry * (1 - tpFrac)) : null;
  const stopLossPrice =
    slFrac > 0 ? (side === "long" ? entry * (1 - slFrac) : entry * (1 + slFrac)) : null;
  return { targetPrice, stopLossPrice };
}

/** Adds target/stop from saved hedge-scalping % (D1 anchor + per D2 scalp clip). */
function augmentHedgeScalpingLegExitPrices(
  leg: ActivePositionLeg,
  settings: HedgeScalpingDisplaySettings | null,
): ActivePositionLeg {
  if (!settings || !isHedgeScalpingStrategySlug(leg.strategySlug)) return leg;
  const entry = leg.displayAvgEntryPrice ?? leg.avgEntryPrice;
  if (leg.account === "D1") {
    return {
      ...leg,
      ...computePctBasedExitPrices({
        side: leg.side,
        entry,
        targetProfitPct: settings.d1TargetProfitPct,
        stopLossPct: settings.d1StopLossPct,
      }),
    };
  }
  return {
    ...leg,
    ...computePctBasedExitPrices({
      side: leg.side,
      entry,
      targetProfitPct: settings.d2TargetProfitPct,
      stopLossPct: settings.d2StopLossPct,
    }),
  };
}

type HedgeScalpingOrderRow = {
  symbol: string;
  side: string;
  quantity: string;
  fillPrice: string | null;
  status: string;
  correlationId: string | null;
  signalAction: string | null;
  createdAt: Date;
};

function buildHedgeScalpingVirtualLegs(params: {
  userId: string;
  userLabel?: string;
  virtualRunId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  orderRows: HedgeScalpingOrderRow[];
  markBySymbol: Map<string, number>;
  hedgeSettings: HedgeScalpingDisplaySettings | null;
}): ActivePositionLeg[] {
  const d1Rows = params.orderRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d1_"));
  const d2RowsAll = params.orderRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d2_"));
  const d2Rows = [...d2RowsAll].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  type Bucket = { step: number; rows: HedgeScalpingOrderRow[] };
  const clipMap = new Map<string, Bucket>();

  for (const row of d2Rows) {
    const entry = parseHsD2EntryCorrelation(row.correlationId);
    if (entry) {
      const b = clipMap.get(entry.clipId) ?? { step: entry.step, rows: [] };
      b.step = entry.step;
      b.rows.push(row);
      clipMap.set(entry.clipId, b);
      continue;
    }
    const exitClipId = parseHsD2ExitClipId(row.correlationId);
    if (exitClipId) {
      const b = clipMap.get(exitClipId) ?? { step: 0, rows: [] };
      b.rows.push(row);
      clipMap.set(exitClipId, b);
    }
  }

  const legs: ActivePositionLeg[] = [];

  const pOrd = ordersToLedgerRows(
    [...d1Rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  );
  const l1 = buildLegVirtual({
    userId: params.userId,
    userLabel: params.userLabel,
    virtualRunId: params.virtualRunId,
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    strategySlug: params.strategySlug,
    account: "D1",
    orders: pOrd,
    markBySymbol: params.markBySymbol,
    qtyPctOfCapital: params.hedgeSettings?.d1QtyPctOfCapital ?? null,
  });
  if (l1) {
    legs.push(augmentHedgeScalpingLegExitPrices(l1, params.hedgeSettings));
  }

  const clipIds = [...clipMap.keys()].sort((a, b) => {
    const sa = clipMap.get(a)!.step;
    const sb = clipMap.get(b)!.step;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });

  for (const clipId of clipIds) {
    const bucket = clipMap.get(clipId)!;
    const sortedRows = [...bucket.rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const clipLedger = ordersToLedgerRows(sortedRows);
    const stepForLeg = bucket.step > 0 ? bucket.step : null;
    const l2 = buildLegVirtual({
      userId: params.userId,
      userLabel: params.userLabel,
      virtualRunId: params.virtualRunId,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      strategySlug: params.strategySlug,
      account: "D2",
      orders: clipLedger,
      markBySymbol: params.markBySymbol,
      qtyPctOfCapital: params.hedgeSettings?.d2QtyPctOfCapital ?? null,
      d2LadderStep: stepForLeg,
      legKeySuffix: `clip:${clipId}`,
    });
    if (l2) {
      legs.push(augmentHedgeScalpingLegExitPrices(l2, params.hedgeSettings));
    }
  }

  const hasD2Leg = legs.some((l) => l.account === "D2");
  if (!hasD2Leg && d2Rows.length > 0) {
    const sOrd = ordersToLedgerRows(d2Rows);
    const l2 = buildLegVirtual({
      userId: params.userId,
      userLabel: params.userLabel,
      virtualRunId: params.virtualRunId,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      strategySlug: params.strategySlug,
      account: "D2",
      orders: sOrd,
      markBySymbol: params.markBySymbol,
      qtyPctOfCapital: params.hedgeSettings?.d2QtyPctOfCapital ?? null,
    });
    if (l2) {
      legs.push(augmentHedgeScalpingLegExitPrices(l2, params.hedgeSettings));
    }
  }

  return legs;
}

function latestEntryDisplayForAccount(params: {
  strategySlug: string;
  account: "D1" | "D2";
  orderRows: {
    symbol: string;
    side: string;
    quantity: string;
    fillPrice: string | null;
    status: string;
    correlationId: string | null;
    signalAction: string | null;
    createdAt: Date;
  }[];
}): { qty: number; entryPrice: number | null } | null {
  const filtered = params.orderRows
    .filter((row) => row.status === "filled" || row.status === "partial_fill")
    .filter((row) => row.signalAction === "entry")
    .filter((row) =>
      isHedgeScalpingStrategySlug(params.strategySlug)
        ? params.account === "D2"
          ? parseHsD2EntryCorrelation(row.correlationId) != null
          : (row.correlationId ?? "").startsWith("hs_d1_")
        : params.account === "D1",
    );
  if (filtered.length === 0) return null;
  const latest = filtered[filtered.length - 1]!;
  const qty = Math.abs(Number(latest.quantity));
  const entryPrice = latest.fillPrice != null ? Number(latest.fillPrice) : null;
  if (!(Number.isFinite(qty) && qty > QTY_EPS)) return null;
  return { qty, entryPrice: Number.isFinite(entryPrice) && (entryPrice ?? 0) > 0 ? entryPrice : null };
}

function closedLegSideFromExitOrder(side: string): "long" | "short" {
  return side === "sell" ? "long" : "short";
}

function buildClosedLegHistoryRows(params: {
  virtualRunId: string;
  strategySlug: string;
  hedgeSettings?: HedgeScalpingDisplaySettings | null;
  orderRows: {
    id: string;
    symbol: string;
    side: string;
    quantity: string;
    fillPrice: string | null;
    status: string;
    correlationId: string | null;
    realizedPnlUsd: string | null;
    profitPercent: string | null;
    signalAction: string | null;
    createdAt: Date;
  }[];
}): UserClosedLegHistoryRow[] {
  const hedgeSettings = params.hedgeSettings ?? null;
  return params.orderRows
    .filter((row) => {
      if (!(row.status === "filled" || row.status === "partial_fill")) return false;
      if (row.signalAction !== "exit") return false;
      return row.fillPrice != null;
    })
    .map((row) => {
      const isHs = isHedgeScalpingStrategySlug(params.strategySlug);
      const isD2 = isHs ? /^hs_d2_/i.test(row.correlationId ?? "") : false;
      const exitClipId = isHs && isD2 ? parseHsD2ExitClipId(row.correlationId) : null;
      const d2LadderStep =
        exitClipId != null ? hedgeScalpingD2StepFromClipId(exitClipId, params.orderRows) : null;
      return {
        key: `closed:${params.virtualRunId}:${row.id}`,
        account: (isD2 ? "D2" : "D1") as "D1" | "D2",
        symbol: row.symbol,
        side: closedLegSideFromExitOrder(row.side),
        quantity: Math.abs(Number(row.quantity)),
        fillPrice: row.fillPrice != null ? Number(row.fillPrice) : null,
        realizedPnlUsd: Number(row.realizedPnlUsd ?? "0"),
        profitPercent: row.profitPercent != null ? Number(row.profitPercent) : null,
        closedAt: row.createdAt.toISOString(),
        qtyPctOfCapital: isD2
          ? hedgeSettings?.d2QtyPctOfCapital ?? null
          : hedgeSettings?.d1QtyPctOfCapital ?? null,
        d2LadderStep: isHs && isD2 ? d2LadderStep : undefined,
      };
    })
    .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
}

function buildParticipationMapFromLegs(
  legs: ActivePositionLeg[],
  userInfo: Map<string, { email: string; name: string | null }>,
): Map<string, string> {
  const byStrat = new Map<string, Set<string>>();
  for (const leg of legs) {
    const u = userInfo.get(leg.userId);
    const short = u
      ? participationShortLabel(u.name, u.email)
      : leg.userLabel
        ? leg.userLabel.trim().split(/\s+/)[0] ?? leg.userLabel
        : `user ${leg.userId.slice(0, 6)}`;
    const mode = leg.mode === "virtual" ? "Virtual" : "Real";
    const label = `${short} (${mode})`;
    const set = byStrat.get(leg.strategyId) ?? new Set<string>();
    set.add(label);
    byStrat.set(leg.strategyId, set);
  }
  return new Map(
    [...byStrat.entries()].map(([k, set]) => [k, [...set].sort().join(", ")]),
  );
}

/**
 * Paper-trading open legs for one user (virtual runs with status = active and non-flat position).
 */
export async function getUserVirtualActivePositionGroups(
  userId: string,
): Promise<UserActivePositionGroup[]> {
  if (!db) return [];

  const runs = await db
    .select({
      runId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      strategySettingsJson: strategies.settingsJson,
      openNetQty: virtualStrategyRuns.openNetQty,
      openAvgEntryPrice: virtualStrategyRuns.openAvgEntryPrice,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(
      and(
        eq(virtualStrategyRuns.userId, userId),
        eq(virtualStrategyRuns.status, "active"),
        isNull(strategies.deletedAt),
      ),
    )
    .orderBy(desc(virtualStrategyRuns.updatedAt));

  const groups: UserActivePositionGroup[] = [];

  type RunCtx = {
    runId: string;
    strategyId: string;
    strategyName: string;
    strategySlug: string;
    openNetQty: string;
    openAvgEntryPrice: string;
    openSymbol: string | null;
    orderRows: {
      id: string;
      symbol: string;
      side: string;
      quantity: string;
      fillPrice: string | null;
      status: string;
      correlationId: string | null;
      realizedPnlUsd: string | null;
      profitPercent: string | null;
      signalAction: string | null;
      rawSubmitResponse: Record<string, unknown> | null;
      createdAt: Date;
    }[];
    ledger: LedgerOrderRow[];
    isHs: boolean;
    hedgeSettings: HedgeScalpingDisplaySettings | null;
  };
  const runCtx: RunCtx[] = [];
  const allSyms: string[] = [];

  for (const run of runs) {
    const orderRows = await db
      .select({
        id: virtualBotOrders.id,
        symbol: virtualBotOrders.symbol,
        side: virtualBotOrders.side,
        quantity: virtualBotOrders.quantity,
        fillPrice: virtualBotOrders.fillPrice,
        status: virtualBotOrders.status,
        correlationId: virtualBotOrders.correlationId,
        realizedPnlUsd: virtualBotOrders.realizedPnlUsd,
        profitPercent: virtualBotOrders.profitPercent,
        signalAction: virtualBotOrders.signalAction,
        rawSubmitResponse: virtualBotOrders.rawSubmitResponse,
        createdAt: virtualBotOrders.createdAt,
      })
      .from(virtualBotOrders)
      .where(
        and(
          eq(virtualBotOrders.virtualRunId, run.runId),
          eq(virtualBotOrders.userId, userId),
        ),
      )
      .orderBy(virtualBotOrders.createdAt);

    const ledger = ordersToLedgerRows(orderRows);
    const isHs = isHedgeScalpingStrategySlug(run.strategySlug);
    const hedgeSettings = parseHedgeScalpingDisplaySettings(run.strategySettingsJson);

    if (isHs && orderRows.length > 0) {
      const d1Rows = orderRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d1_"));
      const d2Rows = orderRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d2_"));
      const symRow = d1Rows[d1Rows.length - 1] ?? d2Rows[d2Rows.length - 1];
      if (symRow) allSyms.push(symRow.symbol);
    } else if (ledger.length > 0) {
      allSyms.push(ledger[ledger.length - 1]!.symbol);
    }

    runCtx.push({
      runId: run.runId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      openNetQty: String(run.openNetQty ?? "0"),
      openAvgEntryPrice: String(run.openAvgEntryPrice ?? "0"),
      openSymbol: run.openSymbol,
      orderRows: orderRows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        quantity: String(row.quantity),
        fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
        status: row.status,
        correlationId: row.correlationId,
        realizedPnlUsd: row.realizedPnlUsd != null ? String(row.realizedPnlUsd) : null,
        profitPercent: row.profitPercent != null ? String(row.profitPercent) : null,
        signalAction: row.signalAction,
        rawSubmitResponse: (row.rawSubmitResponse as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt,
      })),
      ledger,
      isHs,
      hedgeSettings,
    });
  }

  const markBySymbol = await fetchMarksForSymbols(allSyms);

  for (const run of runCtx) {
    const isHs = run.isHs;
    const ledger = run.ledger;
    const legs: ActivePositionLeg[] = [];
    const closedLegs = buildClosedLegHistoryRows({
      virtualRunId: run.runId,
      strategySlug: run.strategySlug,
      hedgeSettings: run.hedgeSettings,
      orderRows: run.orderRows,
    });
    if (isHs) {
      legs.push(
        ...buildHedgeScalpingVirtualLegs({
          userId,
          virtualRunId: run.runId,
          strategyId: run.strategyId,
          strategyName: run.strategyName,
          strategySlug: run.strategySlug,
          orderRows: run.orderRows,
          markBySymbol,
          hedgeSettings: run.hedgeSettings,
        }),
      );
    } else {
      const l = buildLegVirtual({
        userId,
        virtualRunId: run.runId,
        strategyId: run.strategyId,
        strategyName: run.strategyName,
        strategySlug: run.strategySlug,
        account: "D1",
        orders: ledger,
        markBySymbol,
        displayNetQtyOverride: Math.abs(Number(run.openNetQty)),
        displayAvgEntryPriceOverride: Number(run.openAvgEntryPrice) || null,
        qtyPctOfCapital: null,
      });
      if (l) legs.push(l);
    }

    if (legs.length === 0) continue;

    const activePnlUsd = legs.reduce((sum, leg) => sum + leg.unrealizedPnlUsd, 0);
    const realizedPnlUsd = legs.reduce((sum, leg) => sum + leg.realizedPnlUsd, 0);
    groups.push({
      runId: run.runId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      isHedgeScalping: isHs,
      legs,
      closedLegs,
      activePnlUsd,
      realizedPnlUsd,
    });
  }

  return groups;
}

/**
 * Global monitor: virtual + real open legs for active runs.
 */
export async function getAdminLiveTradeMonitorRows(): Promise<AdminLivePositionRow[]> {
  if (!db) return [];

  const legs: ActivePositionLeg[] = [];
  const symbolBatch: string[] = [];

  const vruns = await db
    .select({
      runId: virtualStrategyRuns.id,
      userId: virtualStrategyRuns.userId,
      strategyId: virtualStrategyRuns.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      strategySettingsJson: strategies.settingsJson,
      userEmail: users.email,
      userName: users.name,
      openNetQty: virtualStrategyRuns.openNetQty,
      openAvgEntryPrice: virtualStrategyRuns.openAvgEntryPrice,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .innerJoin(users, eq(virtualStrategyRuns.userId, users.id))
    .where(
      and(eq(virtualStrategyRuns.status, "active"), isNull(strategies.deletedAt), isNull(users.deletedAt)),
    );

  type VRunCtx = {
    runId: string;
    userId: string;
    strategyId: string;
    strategyName: string;
    strategySlug: string;
    hedgeSettings: HedgeScalpingDisplaySettings | null;
    openNetQty: string;
    openAvgEntryPrice: string;
    openSymbol: string | null;
    orderRows: {
      symbol: string;
      side: string;
      quantity: string;
      fillPrice: string | null;
      status: string;
      correlationId: string | null;
      signalAction: string | null;
      rawSubmitResponse: Record<string, unknown> | null;
      createdAt: Date;
    }[];
    ledger: LedgerOrderRow[];
    isHs: boolean;
    label: string;
  };
  const vctx: VRunCtx[] = [];

  for (const run of vruns) {
    const orderRows = await db
      .select({
        symbol: virtualBotOrders.symbol,
        side: virtualBotOrders.side,
        quantity: virtualBotOrders.quantity,
        fillPrice: virtualBotOrders.fillPrice,
        status: virtualBotOrders.status,
        correlationId: virtualBotOrders.correlationId,
        signalAction: virtualBotOrders.signalAction,
        rawSubmitResponse: virtualBotOrders.rawSubmitResponse,
        createdAt: virtualBotOrders.createdAt,
      })
      .from(virtualBotOrders)
      .where(
        and(
          eq(virtualBotOrders.virtualRunId, run.runId),
          eq(virtualBotOrders.userId, run.userId),
        ),
      )
      .orderBy(virtualBotOrders.createdAt);

    const ledger = ordersToLedgerRows(orderRows);
    const isHs = isHedgeScalpingStrategySlug(run.strategySlug);
    const label = userDisplayName(run.userEmail, run.userName);

    if (isHs && orderRows.length > 0) {
      const d1Rows = orderRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d1_"));
      const d2Rows = orderRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d2_"));
      const symRow = d1Rows[d1Rows.length - 1] ?? d2Rows[d2Rows.length - 1];
      if (symRow) symbolBatch.push(symRow.symbol);
    } else if (ledger.length > 0) {
      symbolBatch.push(ledger[ledger.length - 1]!.symbol);
    }

    vctx.push({
      runId: run.runId,
      userId: run.userId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      hedgeSettings: parseHedgeScalpingDisplaySettings(run.strategySettingsJson),
      openNetQty: String(run.openNetQty ?? "0"),
      openAvgEntryPrice: String(run.openAvgEntryPrice ?? "0"),
      openSymbol: run.openSymbol,
      orderRows: orderRows.map((row) => ({
        symbol: row.symbol,
        side: row.side,
        quantity: String(row.quantity),
        fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
        status: row.status,
        correlationId: row.correlationId,
        signalAction: row.signalAction,
        rawSubmitResponse: (row.rawSubmitResponse as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt,
      })),
      ledger,
      isHs,
      label,
    });
  }

  const realRows = await db
    .select({
      userId: botPositions.userId,
      subscriptionId: botPositions.subscriptionId,
      strategyId: botPositions.strategyId,
      exchangeConnectionId: botPositions.exchangeConnectionId,
      symbol: botPositions.symbol,
      netQty: botPositions.netQuantity,
      runId: userStrategyRuns.id,
      primaryEx: userStrategyRuns.primaryExchangeConnectionId,
      secondaryEx: userStrategyRuns.secondaryExchangeConnectionId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      strategySettingsJson: strategies.settingsJson,
      userEmail: users.email,
      userName: users.name,
    })
    .from(botPositions)
    .innerJoin(
      userStrategyRuns,
      eq(botPositions.subscriptionId, userStrategyRuns.subscriptionId),
    )
    .innerJoin(strategies, eq(botPositions.strategyId, strategies.id))
    .innerJoin(users, eq(botPositions.userId, users.id))
    .where(
      and(
        eq(userStrategyRuns.status, "active"),
        isNull(strategies.deletedAt),
        isNull(users.deletedAt),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > 0.00000001`,
      ),
    );

  type RCtx = {
    userId: string;
    runId: string;
    strategyId: string;
    strategyName: string;
    strategySlug: string;
    hedgeSettings: HedgeScalpingDisplaySettings | null;
    symbol: string;
    exchangeConnectionId: string;
    primaryEx: string | null;
    secondaryEx: string | null;
    label: string;
  };
  const rctx: RCtx[] = [];

  for (const row of realRows) {
    symbolBatch.push(row.symbol);
    rctx.push({
      userId: row.userId,
      runId: row.runId,
      strategyId: row.strategyId,
      strategyName: row.strategyName,
      strategySlug: row.strategySlug,
      hedgeSettings: parseHedgeScalpingDisplaySettings(row.strategySettingsJson),
      symbol: row.symbol,
      exchangeConnectionId: row.exchangeConnectionId,
      primaryEx: row.primaryEx,
      secondaryEx: row.secondaryEx,
      label: userDisplayName(row.userEmail, row.userName),
    });
  }

  const markBySymbol = await fetchMarksForSymbols(symbolBatch);

  for (const c of vctx) {
    if (c.isHs) {
      legs.push(
        ...buildHedgeScalpingVirtualLegs({
          userId: c.userId,
          userLabel: c.label,
          virtualRunId: c.runId,
          strategyId: c.strategyId,
          strategyName: c.strategyName,
          strategySlug: c.strategySlug,
          orderRows: c.orderRows,
          markBySymbol,
          hedgeSettings: c.hedgeSettings,
        }),
      );
    } else {
      const l = buildLegVirtual({
        userId: c.userId,
        virtualRunId: c.runId,
        strategyId: c.strategyId,
        strategyName: c.strategyName,
        strategySlug: c.strategySlug,
        account: "D1",
        orders: c.ledger,
        markBySymbol,
        userLabel: c.label,
        displayNetQtyOverride: Math.abs(Number(c.openNetQty)),
        displayAvgEntryPriceOverride: Number(c.openAvgEntryPrice) || null,
        qtyPctOfCapital: null,
      });
      if (l) legs.push(l);
    }
  }

  const userInfo = new Map<string, { email: string; name: string | null }>();
  for (const v of vruns) {
    userInfo.set(v.userId, { email: v.userEmail, name: v.userName });
  }
  for (const row of realRows) {
    userInfo.set(row.userId, { email: row.userEmail, name: row.userName });
  }

  const botOrderSelect = {
    symbol: botOrders.symbol,
    side: botOrders.side,
    quantity: botOrders.quantity,
    fillPrice: botOrders.fillPrice,
    status: botOrders.status,
    correlationId: botOrders.correlationId,
    rawSubmitResponse: botOrders.rawSubmitResponse,
    createdAt: botOrders.createdAt,
  };

  for (const r of rctx) {
    const account: "D1" | "D2" =
      r.secondaryEx && r.exchangeConnectionId === r.secondaryEx
        ? "D2"
        : "D1";
    const isHs = isHedgeScalpingStrategySlug(r.strategySlug);

    const boRows = await db
      .select(botOrderSelect)
      .from(botOrders)
      .where(
        and(
          eq(botOrders.runId, r.runId),
          eq(botOrders.userId, r.userId),
          eq(botOrders.strategyId, r.strategyId),
          eq(botOrders.exchangeConnectionId, r.exchangeConnectionId),
          eq(botOrders.symbol, r.symbol),
        ),
      )
      .orderBy(asc(botOrders.createdAt));

    const ledger = ordersToLedgerRows(boRows);
    const lr = buildLegReal({
      userId: r.userId,
      userLabel: r.label,
      runId: r.runId,
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      strategySlug: r.strategySlug,
      account,
      orders: ledger,
      markBySymbol,
      symbolHint: r.symbol,
      qtyPctOfCapital:
        isHs && r.hedgeSettings
          ? account === "D2"
            ? r.hedgeSettings.d2QtyPctOfCapital
            : r.hedgeSettings.d1QtyPctOfCapital
          : null,
      activeClipCount: null,
    });
    if (lr) {
      legs.push(
        isHs && r.hedgeSettings
          ? augmentHedgeScalpingLegExitPrices(lr, r.hedgeSettings)
          : lr,
      );
    }
  }

  const partMap = buildParticipationMapFromLegs(legs, userInfo);

  return legs.map((row) => ({
    ...row,
    participatingUsers: partMap.get(row.strategyId) ?? "—",
  }));
}

async function getAdminStrategyStatusRows(
  _openLegRows: AdminLivePositionRow[],
): Promise<AdminStrategyStatusRow[]> {
  return [];
}

export async function getAdminLiveTradeMonitorData(): Promise<AdminLiveTradeMonitorData> {
  const rows = await getAdminLiveTradeMonitorRows();
  const statusRows = await getAdminStrategyStatusRows(rows);
  return { rows, statusRows };
}
