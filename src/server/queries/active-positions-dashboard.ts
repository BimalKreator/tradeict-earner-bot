import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { trendArbStrategyConfigSchema } from "@/lib/trend-arb-strategy-config";
import {
  classifyTrendArbAccount,
  deriveLedgerMetrics,
  isFilledOrder,
  isTrendArbSlug,
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
import {
  getTrendArbMarketPulse,
  type TrendArbMarketPulse,
} from "@/server/trading/ta-engine/trend-arb-strategy-pulse";
import {
  normalizeDeltaCandlesSymbol,
  TREND_ARB_TARGET_CLOSED_BARS,
} from "@/server/trading/ta-engine/rsi-scalper";

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
};

export type UserActivePositionGroup = {
  runId: string;
  strategyName: string;
  strategySlug: string;
  isTrendArb: boolean;
  legs: ActivePositionLeg[];
  closedLegs: UserClosedLegHistoryRow[];
  activePnlUsd: number;
  realizedPnlUsd: number;
};

export type StrategyPulseChecklist = TrendArbMarketPulse & {
  d1Status: "Waiting" | "Active";
};

export type AdminLivePositionRow = ActivePositionLeg & {
  participatingUsers: string;
  /** Trend arbitrage only — market + per-user D1 snapshot. */
  strategyPulse?: StrategyPulseChecklist;
};

export type AdminStrategyStatusRow = {
  key: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  mode: "virtual" | "real";
  userLabel: string;
  participatingUsers: string;
  strategyPulse: StrategyPulseChecklist;
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

  return {
    key: `v:${params.virtualRunId}:${params.account}`,
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

type TrendArbDisplaySettings = {
  d1QtyPctOfCapital: number;
  d2QtyPctOfCapital: number;
};

function parseTrendArbDisplaySettings(
  settingsJson: Record<string, unknown> | null | undefined,
): TrendArbDisplaySettings | null {
  const parsed = trendArbStrategyConfigSchema.safeParse(settingsJson ?? null);
  if (!parsed.success) return null;
  return {
    d1QtyPctOfCapital: parsed.data.delta1.entryQtyPct,
    d2QtyPctOfCapital: parsed.data.delta2.stepQtyPct,
  };
}

function deriveTrendArbSecondaryClipCount(orders: LedgerOrderRow[], openNetQty: number): number | null {
  if (!(Number.isFinite(openNetQty) && Math.abs(openNetQty) > QTY_EPS)) {
    return 0;
  }
  const entryClipQty = orders
    .filter((o) => {
      const cid = (o.correlationId ?? "").toLowerCase();
      return cid.includes("_d2_") && !cid.includes("_d2_flat_");
    })
    .map((o) => Math.abs(Number(o.quantity)))
    .find((qty) => Number.isFinite(qty) && qty > QTY_EPS);
  if (!(entryClipQty && entryClipQty > QTY_EPS)) return null;
  return Math.max(0, Math.round(Math.abs(openNetQty) / entryClipQty));
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
      isTrendArbSlug(params.strategySlug)
        ? (params.account === "D2"
            ? classifyTrendArbAccount({ correlationId: row.correlationId }) === "secondary"
            : classifyTrendArbAccount({ correlationId: row.correlationId }) === "primary")
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
  strategySettings: TrendArbDisplaySettings | null;
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
  return params.orderRows
    .filter((row) => {
      if (!(row.status === "filled" || row.status === "partial_fill")) return false;
      if (row.signalAction !== "exit") return false;
      return row.fillPrice != null;
    })
    .map((row) => {
      const isD2 = isTrendArbSlug(params.strategySlug)
        ? classifyTrendArbAccount({ correlationId: row.correlationId }) === "secondary"
        : false;
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
          ? params.strategySettings?.d2QtyPctOfCapital ?? null
          : params.strategySettings?.d1QtyPctOfCapital ?? null,
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

function d1RunStatusKey(leg: ActivePositionLeg): string {
  if (leg.mode === "virtual" && leg.virtualRunId) {
    return `v:${leg.userId}:${leg.virtualRunId}`;
  }
  if (leg.runId) {
    return `r:${leg.userId}:${leg.runId}`;
  }
  return `u:${leg.userId}`;
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
    strategySettings: TrendArbDisplaySettings | null;
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
      createdAt: Date;
    }[];
    ledger: LedgerOrderRow[];
    isTa: boolean;
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
    const isTa = isTrendArbSlug(run.strategySlug);
    const strategySettings = parseTrendArbDisplaySettings(run.strategySettingsJson);

    if (isTa) {
      const pOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "primary");
      const sOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "secondary");
      if (pOrd.length > 0) allSyms.push(pOrd[pOrd.length - 1]!.symbol);
      if (sOrd.length > 0) allSyms.push(sOrd[sOrd.length - 1]!.symbol);
      if (run.openSymbol) allSyms.push(run.openSymbol);
    } else if (ledger.length > 0) {
      allSyms.push(ledger[ledger.length - 1]!.symbol);
    }

    runCtx.push({
      runId: run.runId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      strategySettings,
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
        createdAt: row.createdAt,
      })),
      ledger,
      isTa,
    });
  }

  const markBySymbol = await fetchMarksForSymbols(allSyms);

  for (const run of runCtx) {
    const isTa = run.isTa;
    const ledger = run.ledger;
    const legs: ActivePositionLeg[] = [];
    const closedLegs = buildClosedLegHistoryRows({
      virtualRunId: run.runId,
      strategySlug: run.strategySlug,
      strategySettings: run.strategySettings,
      orderRows: run.orderRows,
    });
    if (isTa) {
      const pOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "primary");
      const sOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "secondary");
      const l1 = buildLegVirtual({
        userId,
        virtualRunId: run.runId,
        strategyId: run.strategyId,
        strategyName: run.strategyName,
        strategySlug: run.strategySlug,
        account: "D1",
        orders: pOrd,
        markBySymbol,
        overrideOpenNetQty: Number(run.openNetQty),
        overrideAvgEntryPrice: Number(run.openAvgEntryPrice),
        overrideOpenSymbol: run.openSymbol,
        displayNetQtyOverride: Math.abs(Number(run.openNetQty)),
        displayAvgEntryPriceOverride: Number(run.openAvgEntryPrice) || null,
        qtyPctOfCapital: run.strategySettings?.d1QtyPctOfCapital ?? null,
      });
      const d2OpenNetQty = deriveLedgerMetrics(extractCurrentOpenLedgerWindow(sOrd), null).openNetQty;
      const d2LatestEntry = latestEntryDisplayForAccount({
        strategySlug: run.strategySlug,
        account: "D2",
        orderRows: run.orderRows,
      });
      const l2 = buildLegVirtual({
        userId,
        virtualRunId: run.runId,
        strategyId: run.strategyId,
        strategyName: run.strategyName,
        strategySlug: run.strategySlug,
        account: "D2",
        orders: sOrd,
        markBySymbol,
        displayNetQtyOverride: d2LatestEntry?.qty ?? null,
        displayAvgEntryPriceOverride: d2LatestEntry?.entryPrice ?? null,
        qtyPctOfCapital: run.strategySettings?.d2QtyPctOfCapital ?? null,
        activeClipCount: deriveTrendArbSecondaryClipCount(sOrd, d2OpenNetQty),
      });
      if (l1) legs.push(l1);
      if (l2) legs.push(l2);
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
        qtyPctOfCapital: run.strategySettings?.d1QtyPctOfCapital ?? null,
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
      isTrendArb: isTa,
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
    strategySettings: TrendArbDisplaySettings | null;
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
      createdAt: Date;
    }[];
    ledger: LedgerOrderRow[];
    isTa: boolean;
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
    const isTa = isTrendArbSlug(run.strategySlug);
    const label = userDisplayName(run.userEmail, run.userName);

    if (isTa) {
      const pOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "primary");
      const sOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "secondary");
      if (pOrd.length > 0) symbolBatch.push(pOrd[pOrd.length - 1]!.symbol);
      if (sOrd.length > 0) symbolBatch.push(sOrd[sOrd.length - 1]!.symbol);
      // Ensure the open-symbol (used for D1 leg override math) has a mark cached.
      if (run.openSymbol) symbolBatch.push(run.openSymbol);
    } else if (ledger.length > 0) {
      symbolBatch.push(ledger[ledger.length - 1]!.symbol);
    }

    vctx.push({
      runId: run.runId,
      userId: run.userId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      strategySettings: parseTrendArbDisplaySettings(run.strategySettingsJson),
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
        createdAt: row.createdAt,
      })),
      ledger,
      isTa,
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
    strategySettings: TrendArbDisplaySettings | null;
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
      strategySettings: parseTrendArbDisplaySettings(row.strategySettingsJson),
      symbol: row.symbol,
      exchangeConnectionId: row.exchangeConnectionId,
      primaryEx: row.primaryEx,
      secondaryEx: row.secondaryEx,
      label: userDisplayName(row.userEmail, row.userName),
    });
  }

  const markBySymbol = await fetchMarksForSymbols(symbolBatch);

  for (const c of vctx) {
    if (c.isTa) {
      const pOrd = c.ledger.filter((o) => classifyTrendArbAccount(o) === "primary");
      const sOrd = c.ledger.filter((o) => classifyTrendArbAccount(o) === "secondary");
      const l1 = buildLegVirtual({
        userId: c.userId,
        virtualRunId: c.runId,
        strategyId: c.strategyId,
        strategyName: c.strategyName,
        strategySlug: c.strategySlug,
        account: "D1",
        orders: pOrd,
        markBySymbol,
        userLabel: c.label,
        overrideOpenNetQty: Number(c.openNetQty),
        overrideAvgEntryPrice: Number(c.openAvgEntryPrice),
        overrideOpenSymbol: c.openSymbol,
        qtyPctOfCapital: c.strategySettings?.d1QtyPctOfCapital ?? null,
      });
      const d2OpenNetQty = deriveLedgerMetrics(extractCurrentOpenLedgerWindow(sOrd), null).openNetQty;
      const d2LatestEntry = latestEntryDisplayForAccount({
        strategySlug: c.strategySlug,
        account: "D2",
        orderRows: c.orderRows,
      });
      const l2 = buildLegVirtual({
        userId: c.userId,
        virtualRunId: c.runId,
        strategyId: c.strategyId,
        strategyName: c.strategyName,
        strategySlug: c.strategySlug,
        account: "D2",
        orders: sOrd,
        markBySymbol,
        userLabel: c.label,
        displayNetQtyOverride: d2LatestEntry?.qty ?? null,
        displayAvgEntryPriceOverride: d2LatestEntry?.entryPrice ?? null,
        qtyPctOfCapital: c.strategySettings?.d2QtyPctOfCapital ?? null,
        activeClipCount: deriveTrendArbSecondaryClipCount(sOrd, d2OpenNetQty),
      });
      if (l1) legs.push(l1);
      if (l2) legs.push(l2);
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
        qtyPctOfCapital: c.strategySettings?.d1QtyPctOfCapital ?? null,
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

  for (const r of rctx) {
    const boRows = await db
      .select({
        symbol: botOrders.symbol,
        side: botOrders.side,
        quantity: botOrders.quantity,
        fillPrice: botOrders.fillPrice,
        status: botOrders.status,
        correlationId: botOrders.correlationId,
        createdAt: botOrders.createdAt,
      })
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
      .orderBy(botOrders.createdAt);

    const ledger = ordersToLedgerRows(boRows);
    const account: "D1" | "D2" =
      r.secondaryEx && r.exchangeConnectionId === r.secondaryEx
        ? "D2"
        : "D1";
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
        account === "D2"
          ? r.strategySettings?.d2QtyPctOfCapital ?? null
          : r.strategySettings?.d1QtyPctOfCapital ?? null,
      activeClipCount:
        account === "D2"
          ? deriveTrendArbSecondaryClipCount(
              ledger,
              deriveLedgerMetrics(extractCurrentOpenLedgerWindow(ledger), null).openNetQty,
            )
          : null,
    });
    if (lr) legs.push(lr);
  }

  const partMap = buildParticipationMapFromLegs(legs, userInfo);

  const d1OpenByRun = new Map<string, boolean>();
  for (const leg of legs) {
    if (leg.account === "D1" && Math.abs(leg.netQty) > QTY_EPS) {
      d1OpenByRun.set(d1RunStatusKey(leg), true);
    }
  }

  const trendStratIds = [
    ...new Set(
      legs.filter((l) => isTrendArbSlug(l.strategySlug)).map((l) => l.strategyId),
    ),
  ];
  const pulseByStrat = new Map<string, TrendArbMarketPulse>();
  for (const sid of trendStratIds) {
    const p = await getTrendArbMarketPulse(sid);
    if (p) pulseByStrat.set(sid, p);
  }

  const pulseBaseUrl = process.env.TA_TREND_ARB_DELTA_BASE_URL?.trim() || "https://api.delta.exchange";

  return legs.map((row) => {
    const participatingUsers = partMap.get(row.strategyId) ?? "—";
    let strategyPulse: StrategyPulseChecklist | undefined;
    if (isTrendArbSlug(row.strategySlug)) {
      const fallbackPulse: TrendArbMarketPulse = {
        barsReady: "Pending",
        trendDirection: "Long",
        priceVsHt: "Below",
        hasEntrySignalBar: false,
        history: {
          targetBars: TREND_ARB_TARGET_CLOSED_BARS,
          rawBars: 0,
          closedBars: 0,
          symbolRequested: row.symbol,
          symbolFetched: normalizeDeltaCandlesSymbol(pulseBaseUrl, row.symbol),
        },
      };
      const m = pulseByStrat.get(row.strategyId) ?? fallbackPulse;
      const d1Status = d1OpenByRun.get(d1RunStatusKey(row)) ? "Active" : "Waiting";
      strategyPulse = { ...m, d1Status };
    }
    return {
      ...row,
      participatingUsers,
      strategyPulse,
    };
  });
}

async function getAdminStrategyStatusRows(
  openLegRows: AdminLivePositionRow[],
): Promise<AdminStrategyStatusRow[]> {
  if (!db) return [];

  const trendLegByStrategy = new Map<string, AdminLivePositionRow>();
  for (const row of openLegRows) {
    if (isTrendArbSlug(row.strategySlug)) {
      if (!trendLegByStrategy.has(row.strategyId)) trendLegByStrategy.set(row.strategyId, row);
    }
  }

  const virtualRuns = await db
    .select({
      runId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .innerJoin(users, eq(virtualStrategyRuns.userId, users.id))
    .where(
      and(eq(virtualStrategyRuns.status, "active"), isNull(strategies.deletedAt), isNull(users.deletedAt)),
    );

  const realRuns = await db
    .select({
      runId: userStrategyRuns.id,
      strategyId: userStrategySubscriptions.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      userId: userStrategySubscriptions.userId,
      userEmail: users.email,
      userName: users.name,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(strategies, eq(userStrategySubscriptions.strategyId, strategies.id))
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .where(and(eq(userStrategyRuns.status, "active"), isNull(strategies.deletedAt), isNull(users.deletedAt)));

  const trendVirtual = virtualRuns.filter((r) => isTrendArbSlug(r.strategySlug));
  const trendReal = realRuns.filter((r) => isTrendArbSlug(r.strategySlug));
  const trendStratIds = [...new Set([...trendVirtual, ...trendReal].map((r) => r.strategyId))];
  if (trendStratIds.length === 0) return [];

  const pulseByStrat = new Map<string, TrendArbMarketPulse>();
  const pulseBaseUrl = process.env.TA_TREND_ARB_DELTA_BASE_URL?.trim() || "https://api.delta.exchange";
  for (const sid of trendStratIds) {
    const p = await getTrendArbMarketPulse(sid);
    if (p) {
      pulseByStrat.set(sid, p);
      continue;
    }
    pulseByStrat.set(sid, {
      barsReady: "Pending",
      trendDirection: "Long",
      priceVsHt: "Below",
      hasEntrySignalBar: false,
      history: {
        targetBars: TREND_ARB_TARGET_CLOSED_BARS,
        rawBars: 0,
        closedBars: 0,
        symbolRequested: "BTC_USDT",
        symbolFetched: normalizeDeltaCandlesSymbol(pulseBaseUrl, "BTC_USDT"),
      },
    });
  }

  const participantsByStrategy = new Map<string, Set<string>>();
  for (const run of trendVirtual) {
    const first = participationShortLabel(run.userName, run.userEmail);
    const set = participantsByStrategy.get(run.strategyId) ?? new Set<string>();
    set.add(`${first} (Virtual)`);
    participantsByStrategy.set(run.strategyId, set);
  }
  for (const run of trendReal) {
    const first = participationShortLabel(run.userName, run.userEmail);
    const set = participantsByStrategy.get(run.strategyId) ?? new Set<string>();
    set.add(`${first} (Real)`);
    participantsByStrategy.set(run.strategyId, set);
  }

  const out: AdminStrategyStatusRow[] = [];
  for (const run of trendVirtual) {
    const pulse = pulseByStrat.get(run.strategyId);
    if (!pulse) continue;
    out.push({
      key: `status:v:${run.runId}`,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      mode: "virtual",
      userLabel: userDisplayName(run.userEmail, run.userName),
      participatingUsers: [...(participantsByStrategy.get(run.strategyId) ?? new Set<string>())]
        .sort()
        .join(", "),
      strategyPulse: {
        ...pulse,
        d1Status: trendLegByStrategy.get(run.strategyId)?.strategyPulse?.d1Status ?? "Waiting",
      },
    });
  }
  for (const run of trendReal) {
    const pulse = pulseByStrat.get(run.strategyId);
    if (!pulse) continue;
    out.push({
      key: `status:r:${run.runId}`,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      mode: "real",
      userLabel: userDisplayName(run.userEmail, run.userName),
      participatingUsers: [...(participantsByStrategy.get(run.strategyId) ?? new Set<string>())]
        .sort()
        .join(", "),
      strategyPulse: {
        ...pulse,
        d1Status: trendLegByStrategy.get(run.strategyId)?.strategyPulse?.d1Status ?? "Waiting",
      },
    });
  }
  return out;
}

export async function getAdminLiveTradeMonitorData(): Promise<AdminLiveTradeMonitorData> {
  const rows = await getAdminLiveTradeMonitorRows();
  const statusRows = await getAdminStrategyStatusRows(rows);
  return { rows, statusRows };
}
