import { and, desc, eq, isNull, sql } from "drizzle-orm";

import {
  classifyTrendArbAccount,
  deriveLedgerMetrics,
  isTrendArbSlug,
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
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  markPrice: number | null;
};

export type UserActivePositionGroup = {
  runId: string;
  strategyName: string;
  strategySlug: string;
  isTrendArb: boolean;
  legs: ActivePositionLeg[];
  combinedPnlUsd: number;
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

function buildLegVirtual(params: {
  userId: string;
  virtualRunId: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  account: "D1" | "D2";
  orders: LedgerOrderRow[];
  markBySymbol: Map<string, number>;
  /** Admin monitor: display name for participation column. */
  userLabel?: string;
}): ActivePositionLeg | null {
  const sym = params.orders.length > 0 ? params.orders[params.orders.length - 1]!.symbol : null;
  const mark = sym ? params.markBySymbol.get(sym) ?? null : null;
  const d = deriveLedgerMetrics(params.orders, mark);
  if (Math.abs(d.openNetQty) <= QTY_EPS) return null;
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
    symbol: d.openSymbol ?? sym ?? "—",
    side: legSide(d.openNetQty),
    netQty: d.openNetQty,
    avgEntryPrice: d.avgEntryPrice,
    realizedPnlUsd: d.realizedPnlUsd,
    unrealizedPnlUsd: d.unrealizedPnlUsd,
    markPrice: mark,
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
}): ActivePositionLeg | null {
  const mark = params.markBySymbol.get(params.symbolHint) ?? null;
  const d = deriveLedgerMetrics(params.orders, mark);
  if (Math.abs(d.openNetQty) <= QTY_EPS) return null;
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
    symbol: d.openSymbol ?? params.symbolHint,
    side: legSide(d.openNetQty),
    netQty: d.openNetQty,
    avgEntryPrice: d.avgEntryPrice,
    realizedPnlUsd: d.realizedPnlUsd,
    unrealizedPnlUsd: d.unrealizedPnlUsd,
    markPrice: mark,
  };
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
    ledger: LedgerOrderRow[];
    isTa: boolean;
  };
  const runCtx: RunCtx[] = [];
  const allSyms: string[] = [];

  for (const run of runs) {
    const orderRows = await db
      .select({
        symbol: virtualBotOrders.symbol,
        side: virtualBotOrders.side,
        quantity: virtualBotOrders.quantity,
        fillPrice: virtualBotOrders.fillPrice,
        status: virtualBotOrders.status,
        correlationId: virtualBotOrders.correlationId,
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

    if (isTa) {
      const pOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "primary");
      const sOrd = ledger.filter((o) => classifyTrendArbAccount(o) === "secondary");
      if (pOrd.length > 0) allSyms.push(pOrd[pOrd.length - 1]!.symbol);
      if (sOrd.length > 0) allSyms.push(sOrd[sOrd.length - 1]!.symbol);
    } else if (ledger.length > 0) {
      allSyms.push(ledger[ledger.length - 1]!.symbol);
    }

    runCtx.push({
      runId: run.runId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      ledger,
      isTa,
    });
  }

  const markBySymbol = await fetchMarksForSymbols(allSyms);

  for (const run of runCtx) {
    const isTa = run.isTa;
    const ledger = run.ledger;
    const legs: ActivePositionLeg[] = [];
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
      });
      if (l) legs.push(l);
    }

    if (legs.length === 0) continue;

    const combinedPnlUsd = legs.reduce(
      (s, x) => s + x.realizedPnlUsd + x.unrealizedPnlUsd,
      0,
    );
    groups.push({
      runId: run.runId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
      isTrendArb: isTa,
      legs,
      combinedPnlUsd,
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
      userEmail: users.email,
      userName: users.name,
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
    } else if (ledger.length > 0) {
      symbolBatch.push(ledger[ledger.length - 1]!.symbol);
    }

    vctx.push({
      runId: run.runId,
      userId: run.userId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      strategySlug: run.strategySlug,
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
