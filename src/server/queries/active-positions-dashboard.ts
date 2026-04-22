import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import {
  hedgeScalpingConfigSchema,
  isHedgeScalpingStrategySlug,
} from "@/lib/hedge-scalping-config";
import { isTrendProfitLockScalpingStrategySlug } from "@/lib/trend-profit-lock-config";
import {
  deriveLedgerMetrics,
  isFilledOrder,
  num,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { parseUserStrategyRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { db } from "@/server/db";
import {
  botOrders,
  botPositions,
  hedgeScalpingVirtualRuns,
  strategies,
  userStrategySubscriptions,
  users,
  userStrategyRuns,
  virtualBotOrders,
  virtualStrategyRuns,
} from "@/server/db/schema";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";
import { fetchDeltaIndiaProductContractValue } from "@/server/exchange/delta-product-resolver";
import {
  d1ContinuousTrailedStopPrice,
  d1HardStopPrice,
} from "@/server/trading/hedge-scalping/engine-math";

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
  usedMarginUsd: number | null;
  markPrice: number | null;
  qtyPctOfCapital: number | null;
  activeClipCount: number | null;
  /** One open D2 ladder clip row; unset = combined D2 leg. */
  d2LadderStep?: number | null;
  /** Approximate exit prices from saved strategy % (per leg / clip). */
  targetPrice?: number | null;
  stopLossPrice?: number | null;
  /** Earliest filled order timestamp in the current open ledger window (ISO). */
  openedAt?: string | null;
};

const ABSURD_QTY_MAX = 100_000;
const FRACTIONAL_GHOST_EPS = 1;

function normalizeUsdContractValue(rawContractValueUsd: number | null, markUsd: number | null): number {
  if (
    rawContractValueUsd != null &&
    Number.isFinite(rawContractValueUsd) &&
    rawContractValueUsd > 0
  ) {
    if (rawContractValueUsd >= 0.5) return rawContractValueUsd;
    if (markUsd != null && Number.isFinite(markUsd) && markUsd > 0) {
      const converted = rawContractValueUsd * markUsd;
      if (Number.isFinite(converted) && converted > 0) return converted;
    }
  }
  return 1;
}

function hasAbsurdContractQty(qty: number): boolean {
  const abs = Math.abs(qty);
  return abs >= ABSURD_QTY_MAX || (abs > 0 && abs < FRACTIONAL_GHOST_EPS);
}

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

async function fetchContractValueBySymbol(
  symbols: string[],
  markBySymbol: Map<string, number>,
): Promise<Map<string, number>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, number>();
  await Promise.all(
    uniq.map(async (sym) => {
      const raw = await fetchDeltaIndiaProductContractValue(sym);
      const mark = markBySymbol.get(sym) ?? null;
      out.set(sym, normalizeUsdContractValue(raw, mark));
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

function openedAtFromOpenWindow(openWindow: LedgerOrderRow[]): string | null {
  let earliestMs: number | null = null;
  for (const o of openWindow) {
    if (!isFilledOrder(o.status)) continue;
    const ms = o.createdAt.getTime();
    if (earliestMs == null || ms < earliestMs) earliestMs = ms;
  }
  return earliestMs != null ? new Date(earliestMs).toISOString() : null;
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
  contractValueBySymbol: Map<string, number>;
  /** Optional overrides for admin/user dashboards so virtual run state matches engine math. */
  overrideOpenNetQty?: number;
  overrideAvgEntryPrice?: number | null;
  overrideOpenSymbol?: string | null;
  /** Admin monitor: display name for participation column. */
  userLabel?: string;
  qtyPctOfCapital?: number | null;
  leverage?: number | null;
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
  const contractValueUsd = sym ? (params.contractValueBySymbol.get(sym.toUpperCase()) ?? 1) : 1;
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
      ? netQty * ((mark - avgEntryPrice) / avgEntryPrice) * contractValueUsd
      : dOpen.unrealizedPnlUsd;
  const usedMarginUsd =
    Math.abs(netQty) > QTY_EPS
      ? (Math.abs(netQty) * contractValueUsd) / Math.max(1, params.leverage ?? 1)
      : null;

  const openedAt = openedAtFromOpenWindow(openWindowOrders);

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
    usedMarginUsd,
    markPrice: mark,
    qtyPctOfCapital: params.qtyPctOfCapital ?? null,
    activeClipCount: params.activeClipCount ?? null,
    d2LadderStep: params.d2LadderStep ?? undefined,
    openedAt,
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
  contractValueBySymbol: Map<string, number>;
  symbolHint: string;
  /** Prefer exchange-synced position qty/entry over ledger-derived values when provided. */
  overrideOpenNetQty?: number;
  overrideAvgEntryPrice?: number | null;
  qtyPctOfCapital?: number | null;
  activeClipCount?: number | null;
  leverage?: number | null;
}): ActivePositionLeg | null {
  const openWindowOrders = extractCurrentOpenLedgerWindow(params.orders);
  const mark = params.markBySymbol.get(params.symbolHint) ?? null;
  const contractValueUsd = params.contractValueBySymbol.get(params.symbolHint.toUpperCase()) ?? 1;
  const dOpen = deriveLedgerMetrics(openWindowOrders, mark);
  const dAll = deriveLedgerMetrics(params.orders, mark);
  const openNetQty = params.overrideOpenNetQty ?? dOpen.openNetQty;
  const avgEntryPrice = params.overrideAvgEntryPrice ?? dOpen.avgEntryPrice;
  if (Math.abs(openNetQty) <= QTY_EPS) return null;
  const openedAt = openedAtFromOpenWindow(openWindowOrders);
  const unrealizedPnlUsd =
    openNetQty !== 0 &&
    avgEntryPrice != null &&
    mark != null &&
    avgEntryPrice > 0
      ? openNetQty * ((mark - avgEntryPrice) / avgEntryPrice) * contractValueUsd
      : dOpen.unrealizedPnlUsd;
  const usedMarginUsd =
    Math.abs(openNetQty) > QTY_EPS
      ? (Math.abs(openNetQty) * contractValueUsd) / Math.max(1, params.leverage ?? 1)
      : null;
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
    side: legSide(openNetQty),
    netQty: openNetQty,
    avgEntryPrice,
    displayNetQty: openNetQty,
    displayAvgEntryPrice: avgEntryPrice,
    realizedPnlUsd: dAll.realizedPnlUsd,
    unrealizedPnlUsd,
    usedMarginUsd,
    markPrice: mark,
    qtyPctOfCapital: params.qtyPctOfCapital ?? null,
    activeClipCount: params.activeClipCount ?? null,
    openedAt,
  };
}

function distributeTplD2OpenStepQtyForDisplay(
  states: {
    step: number;
    qty: number;
    targetPrice: number;
    stoplossPrice: number;
    status: string;
  }[],
  exchangeAbsQty: number,
): Map<number, number> {
  const open = states
    .filter((s) => s.status === "open" && Number.isFinite(s.qty) && s.qty > 0)
    .sort((a, b) => a.step - b.step);
  const out = new Map<number, number>();
  const localSum = open.reduce((sum, s) => sum + s.qty, 0);
  if (!(exchangeAbsQty >= 0) || open.length === 0) return out;
  if (exchangeAbsQty >= localSum - QTY_EPS) {
    for (const s of open) out.set(s.step, s.qty);
    return out;
  }
  // Preserve lower steps first; higher steps absorb manual partial closes first.
  let remaining = exchangeAbsQty;
  for (const s of open) {
    const alloc = Math.max(0, Math.min(s.qty, remaining));
    out.set(s.step, alloc);
    remaining -= alloc;
    if (remaining <= QTY_EPS) remaining = 0;
  }
  return out;
}

function expandTrendProfitLockLiveD2Legs(
  leg: ActivePositionLeg,
  runSettingsJson: unknown,
): ActivePositionLeg[] {
  if (leg.account !== "D2" || !isTrendProfitLockScalpingStrategySlug(leg.strategySlug)) {
    return [leg];
  }
  const parsed = parseUserStrategyRunSettingsJson(runSettingsJson);
  const rt = parsed.trendProfitLockRuntime;
  const statesRaw = rt?.d2StepsState ?? {};
  const states = Object.values(statesRaw)
    .filter((s) => s && typeof s === "object" && (s as { status?: string }).status === "open")
    .map((s) => s as {
      step: number;
      qty: number;
      targetPrice: number;
      stoplossPrice: number;
      status: string;
    })
    .sort((a, b) => a.step - b.step);
  if (states.length === 0) return [leg];

  const alloc = distributeTplD2OpenStepQtyForDisplay(states, Math.abs(leg.netQty));
  const sign = leg.side === "short" ? -1 : 1;
  const expanded: ActivePositionLeg[] = [];
  for (const st of states) {
    const q = alloc.get(st.step) ?? 0;
    if (!(q > QTY_EPS)) continue;
    expanded.push({
      ...leg,
      key: `${leg.key}:d2step:${st.step}`,
      d2LadderStep: st.step,
      netQty: sign * q,
      displayNetQty: q,
      targetPrice: st.targetPrice,
      stopLossPrice: st.stoplossPrice,
    });
  }
  return expanded.length > 0 ? expanded : [leg];
}

type HedgeScalpingDisplaySettings = {
  d1QtyPctOfCapital: number;
  d2QtyPctOfCapital: number;
  d1TargetProfitPct: number;
  d1StopLossPct: number;
  d1BreakevenTriggerPct: number;
  d2TargetProfitPct: number;
  d2StopLossPct: number;
};

type HedgeScalpingVirtualRunRow = typeof hedgeScalpingVirtualRuns.$inferSelect;

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
    d1BreakevenTriggerPct: Math.max(0, d1.breakevenTriggerPct),
    d2TargetProfitPct: Math.max(0, d2.targetProfitPct),
    d2StopLossPct: Math.max(0, d2.stopLossPct),
  };
}

function parseHsD1HedgeRunId(correlationId: string | null | undefined): string | null {
  const m = /^hs_d1_([0-9a-f-]{36})$/i.exec(correlationId ?? "");
  return m?.[1] ?? null;
}

function firstHsD1HedgeRunIdFromOrders(
  orderRows: { correlationId: string | null }[],
): string | null {
  for (const row of orderRows) {
    const id = parseHsD1HedgeRunId(row.correlationId);
    if (id) return id;
  }
  return null;
}

/**
 * Prevent UI ghosting: when a new HS D1 run starts in the same virtual paper run,
 * ignore older HS rows before the latest `hs_d1_<runId>` entry marker.
 */
function filterToLatestHsRunSegment<T extends { correlationId: string | null }>(rows: T[]): T[] {
  let latestStartIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const id = parseHsD1HedgeRunId(rows[i]?.correlationId);
    if (id) latestStartIdx = i;
  }
  if (latestStartIdx < 0) {
    return rows.filter((r) => {
      const cid = r.correlationId ?? "";
      return /^hs_d1_/i.test(cid) || /^hs_d2_/i.test(cid);
    });
  }
  return rows.slice(latestStartIdx).filter((r) => {
    const cid = r.correlationId ?? "";
    return /^hs_d1_/i.test(cid) || /^hs_d2_/i.test(cid);
  });
}

async function loadHedgeScalpingVirtualRunsForOrderRowBundles(
  bundles: { orderRows: { correlationId: string | null }[] }[],
): Promise<Map<string, HedgeScalpingVirtualRunRow>> {
  const ids = new Set<string>();
  for (const b of bundles) {
    for (const row of b.orderRows) {
      const id = parseHsD1HedgeRunId(row.correlationId);
      if (id) ids.add(id);
    }
  }
  if (!db || ids.size === 0) return new Map();
  const rows = await db
    .select()
    .from(hedgeScalpingVirtualRuns)
    .where(inArray(hedgeScalpingVirtualRuns.runId, [...ids]));
  return new Map(rows.map((r) => [r.runId, r]));
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
function extractCurrentOpenBotOrderWindowForTpl<T extends { status: string; side: string; quantity: string }>(
  orders: T[],
): T[] {
  if (orders.length === 0) return [];
  let runningNet = 0;
  let lastFlatIdx = -1;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]!;
    if (!isFilledOrder(o.status)) continue;
    const q = num(o.quantity);
    if (!(q > 0)) continue;
    runningNet += o.side === "buy" ? q : -q;
    if (Math.abs(runningNet) <= QTY_EPS) {
      runningNet = 0;
      lastFlatIdx = i;
    }
  }
  if (Math.abs(runningNet) <= QTY_EPS) return [];
  return orders.slice(lastFlatIdx + 1);
}

function parseTplD2StepFromCorrelation(correlationId: string | null | undefined): number | null {
  const m = /^tpl_d2_step_(\d+)_/i.exec(correlationId ?? "");
  if (!m) return null;
  const s = Number(m[1]);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/** Live TPL: show D1/D2 target & stop from `trendProfitLockRuntime` (and ladder step on D2 when known). */
function augmentTrendProfitLockLiveLeg(
  leg: ActivePositionLeg,
  runSettingsJson: unknown,
  tplBoRows: { status: string; side: string; quantity: string; correlationId: string | null }[],
): ActivePositionLeg {
  if (!isTrendProfitLockScalpingStrategySlug(leg.strategySlug)) return leg;
  const parsed = parseUserStrategyRunSettingsJson(runSettingsJson);
  const rt = parsed.trendProfitLockRuntime;
  if (!rt) return leg;
  if (leg.account === "D1" && rt.d1) {
    return {
      ...leg,
      targetPrice: rt.d1.targetPrice,
      stopLossPrice: rt.d1.stoplossPrice,
    };
  }
  if (leg.account === "D2") {
    const openRows = extractCurrentOpenBotOrderWindowForTpl(tplBoRows);
    let stepFromOrders: number | null = null;
    for (let i = openRows.length - 1; i >= 0; i--) {
      const s = parseTplD2StepFromCorrelation(openRows[i]!.correlationId);
      if (s != null) {
        stepFromOrders = s;
        break;
      }
    }
    const states = rt.d2StepsState ?? {};
    let chosen =
      stepFromOrders != null ? states[String(stepFromOrders)] : undefined;
    if (!chosen || chosen.status !== "open") {
      let maxStep = -1;
      for (const st of Object.values(states)) {
        if (st.status === "open" && st.step > maxStep) {
          maxStep = st.step;
          chosen = st;
        }
      }
    }
    if (chosen && chosen.status === "open") {
      return {
        ...leg,
        targetPrice: chosen.targetPrice,
        stopLossPrice: chosen.stoplossPrice,
        d2LadderStep: chosen.step,
      };
    }
  }
  return leg;
}

function augmentHedgeScalpingLegExitPrices(
  leg: ActivePositionLeg,
  settings: HedgeScalpingDisplaySettings | null,
  hedgeRun: HedgeScalpingVirtualRunRow | null = null,
): ActivePositionLeg {
  if (!settings || !isHedgeScalpingStrategySlug(leg.strategySlug)) return leg;
  const entry = leg.displayAvgEntryPrice ?? leg.avgEntryPrice;
  if (leg.account === "D1") {
    const ex = computePctBasedExitPrices({
      side: leg.side,
      entry,
      targetProfitPct: settings.d1TargetProfitPct,
      stopLossPct: settings.d1StopLossPct,
    });
    let stopLossPrice = ex.stopLossPrice;
    if (hedgeRun && hedgeRun.status === "active") {
      const entryHs = num(hedgeRun.d1EntryPrice);
      const maxFav = num(hedgeRun.maxFavorablePrice);
      if (entryHs > 0) {
        const initialSl = d1HardStopPrice(
          hedgeRun.d1Side,
          entryHs,
          settings.d1StopLossPct,
        );
        const { trailedStopPrice } = d1ContinuousTrailedStopPrice(
          hedgeRun.d1Side,
          entryHs,
          maxFav,
          initialSl,
        );
        stopLossPrice = trailedStopPrice;
      }
    }
    return {
      ...leg,
      ...ex,
      stopLossPrice,
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
  contractValueBySymbol: Map<string, number>;
  leverage: number;
  hedgeSettings: HedgeScalpingDisplaySettings | null;
  hedgeRun: HedgeScalpingVirtualRunRow | null;
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
    contractValueBySymbol: params.contractValueBySymbol,
    leverage: params.leverage,
    qtyPctOfCapital: params.hedgeSettings?.d1QtyPctOfCapital ?? null,
  });
  if (l1) {
    legs.push(augmentHedgeScalpingLegExitPrices(l1, params.hedgeSettings, params.hedgeRun));
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
      contractValueBySymbol: params.contractValueBySymbol,
      leverage: params.leverage,
      qtyPctOfCapital: params.hedgeSettings?.d2QtyPctOfCapital ?? null,
      d2LadderStep: stepForLeg,
      legKeySuffix: `clip:${clipId}`,
    });
    if (l2) {
      legs.push(augmentHedgeScalpingLegExitPrices(l2, params.hedgeSettings, null));
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
      contractValueBySymbol: params.contractValueBySymbol,
      leverage: params.leverage,
      qtyPctOfCapital: params.hedgeSettings?.d2QtyPctOfCapital ?? null,
    });
    if (l2) {
      legs.push(augmentHedgeScalpingLegExitPrices(l2, params.hedgeSettings, null));
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

async function flushAbsurdVirtualRunsForUser(userId: string): Promise<void> {
  if (!db) return;
  await db
    .update(virtualStrategyRuns)
    .set({
      status: "completed",
      openNetQty: "0",
      openAvgEntryPrice: null,
      openSymbol: null,
      virtualUsedMarginUsd: "0",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(virtualStrategyRuns.userId, userId),
        eq(virtualStrategyRuns.status, "active"),
        sql`(
          abs(cast(${virtualStrategyRuns.openNetQty} as numeric)) >= ${ABSURD_QTY_MAX}
          or (
            abs(cast(${virtualStrategyRuns.openNetQty} as numeric)) > 0
            and abs(cast(${virtualStrategyRuns.openNetQty} as numeric)) < ${FRACTIONAL_GHOST_EPS}
          )
        )`,
      ),
    );
}

async function flushAbsurdLivePositionsForUser(userId: string): Promise<void> {
  if (!db) return;
  await db
    .update(botPositions)
    .set({
      netQuantity: "0",
      averageEntryPrice: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(botPositions.userId, userId),
        sql`(
          abs(cast(${botPositions.netQuantity} as numeric)) >= ${ABSURD_QTY_MAX}
          or (
            abs(cast(${botPositions.netQuantity} as numeric)) > 0
            and abs(cast(${botPositions.netQuantity} as numeric)) < ${FRACTIONAL_GHOST_EPS}
          )
        )`,
      ),
    );
}

/**
 * Paper-trading open legs for one user (virtual runs with status = active and non-flat position).
 */
export async function getUserVirtualActivePositionGroups(
  userId: string,
): Promise<UserActivePositionGroup[]> {
  if (!db) return [];
  await flushAbsurdVirtualRunsForUser(userId);

  const runs = await db
    .select({
      runId: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      strategySettingsJson: strategies.settingsJson,
      leverage: virtualStrategyRuns.leverage,
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
    leverage: string;
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

    const hsScopedRows = isHedgeScalpingStrategySlug(run.strategySlug)
      ? filterToLatestHsRunSegment(orderRows)
      : orderRows;
    const ledger = ordersToLedgerRows(hsScopedRows);
    const isHs = isHedgeScalpingStrategySlug(run.strategySlug);
    const hedgeSettings = parseHedgeScalpingDisplaySettings(run.strategySettingsJson);

    if (isHs && hsScopedRows.length > 0) {
      const d1Rows = hsScopedRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d1_"));
      const d2Rows = hsScopedRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d2_"));
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
      leverage: String(run.leverage ?? "1"),
      openNetQty: String(run.openNetQty ?? "0"),
      openAvgEntryPrice: String(run.openAvgEntryPrice ?? "0"),
      openSymbol: run.openSymbol,
      orderRows: hsScopedRows.map((row) => ({
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

  const hedgeByRunId = await loadHedgeScalpingVirtualRunsForOrderRowBundles(
    runCtx.filter((r) => r.isHs).map((r) => ({ orderRows: r.orderRows })),
  );

  const markBySymbol = await fetchMarksForSymbols(allSyms);
  const contractValueBySymbol = await fetchContractValueBySymbol(allSyms, markBySymbol);

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
      const hsHedgeId = firstHsD1HedgeRunIdFromOrders(run.orderRows);
      const hedgeRow = hsHedgeId ? (hedgeByRunId.get(hsHedgeId) ?? null) : null;
      legs.push(
        ...buildHedgeScalpingVirtualLegs({
          userId,
          virtualRunId: run.runId,
          strategyId: run.strategyId,
          strategyName: run.strategyName,
          strategySlug: run.strategySlug,
          orderRows: run.orderRows,
          markBySymbol,
          contractValueBySymbol,
          leverage: Math.max(1, Number(run.leverage)),
          hedgeSettings: run.hedgeSettings,
          hedgeRun: hedgeRow,
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
        contractValueBySymbol,
        leverage: Math.max(1, Number(run.leverage)),
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
 * Live-trading open legs for one user (real Delta positions from `bot_positions`).
 * Grouped by run so the UI can mirror virtual D1/D2 leg rendering.
 */
export async function getUserRealActivePositionGroups(
  userId: string,
): Promise<UserActivePositionGroup[]> {
  if (!db) return [];
  await flushAbsurdLivePositionsForUser(userId);
  const now = new Date();

  const realRows = await db
    .select({
      userId: botPositions.userId,
      strategyId: botPositions.strategyId,
      exchangeConnectionId: botPositions.exchangeConnectionId,
      symbol: botPositions.symbol,
      runId: userStrategyRuns.id,
      primaryEx: userStrategyRuns.primaryExchangeConnectionId,
      secondaryEx: userStrategyRuns.secondaryExchangeConnectionId,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      strategySettingsJson: strategies.settingsJson,
      leverage: userStrategyRuns.leverage,
      runSettingsJson: userStrategyRuns.runSettingsJson,
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
    .innerJoin(
      userStrategySubscriptions,
      and(
        eq(userStrategySubscriptions.id, userStrategyRuns.subscriptionId),
        eq(userStrategySubscriptions.userId, botPositions.userId),
      ),
    )
    .where(
      and(
        eq(botPositions.userId, userId),
        eq(userStrategyRuns.status, "active"),
        eq(userStrategySubscriptions.status, "active"),
        gt(userStrategySubscriptions.accessValidUntil, now),
        isNull(userStrategySubscriptions.deletedAt),
        isNull(strategies.deletedAt),
        isNull(users.deletedAt),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > ${QTY_EPS}`,
      ),
    );

  type RealCtx = {
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
    leverage: number;
    runSettingsJson: unknown;
    positionNetQty: number;
  };

  const contexts: RealCtx[] = realRows.map((row) => ({
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
    leverage: Math.max(1, Number(row.leverage ?? "1")),
    runSettingsJson: row.runSettingsJson,
    positionNetQty: Number(row.netQty ?? "0"),
  }));

  const markBySymbol = await fetchMarksForSymbols(contexts.map((c) => c.symbol));
  const contractValueBySymbol = await fetchContractValueBySymbol(
    contexts.map((c) => c.symbol),
    markBySymbol,
  );
  const legs: ActivePositionLeg[] = [];
  for (const r of contexts) {
    const account: "D1" | "D2" =
      r.secondaryEx && r.exchangeConnectionId === r.secondaryEx ? "D2" : "D1";
    const isHs = isHedgeScalpingStrategySlug(r.strategySlug);
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
      .orderBy(asc(botOrders.createdAt));

    const ledger = ordersToLedgerRows(boRows);
    const leg = buildLegReal({
      userId: r.userId,
      userLabel: r.label,
      runId: r.runId,
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      strategySlug: r.strategySlug,
      account,
      orders: ledger,
      markBySymbol,
      contractValueBySymbol,
      leverage: r.leverage,
      symbolHint: r.symbol,
      overrideOpenNetQty: r.positionNetQty,
      qtyPctOfCapital:
        isHs && r.hedgeSettings
          ? account === "D2"
            ? r.hedgeSettings.d2QtyPctOfCapital
            : r.hedgeSettings.d1QtyPctOfCapital
          : null,
      activeClipCount: null,
    });
    if (!leg) continue;
    const tplAugmented = isTrendProfitLockScalpingStrategySlug(r.strategySlug)
      ? augmentTrendProfitLockLiveLeg(leg, r.runSettingsJson, boRows)
      : leg;
    const expandedTplLegs = isTrendProfitLockScalpingStrategySlug(r.strategySlug)
      ? expandTrendProfitLockLiveD2Legs(tplAugmented, r.runSettingsJson)
      : [tplAugmented];
    for (const legItem of expandedTplLegs) {
      legs.push(
        isHs && r.hedgeSettings
          ? augmentHedgeScalpingLegExitPrices(legItem, r.hedgeSettings)
          : legItem,
      );
    }
  }

  const grouped = new Map<string, UserActivePositionGroup>();
  for (const leg of legs) {
    const runId = leg.runId;
    if (!runId) continue;
    const existing = grouped.get(runId);
    if (existing) {
      existing.legs.push(leg);
      existing.activePnlUsd += leg.unrealizedPnlUsd;
      existing.realizedPnlUsd += leg.realizedPnlUsd;
      continue;
    }
    grouped.set(runId, {
      runId,
      strategyName: leg.strategyName,
      strategySlug: leg.strategySlug,
      isHedgeScalping: isHedgeScalpingStrategySlug(leg.strategySlug),
      legs: [leg],
      closedLegs: [],
      activePnlUsd: leg.unrealizedPnlUsd,
      realizedPnlUsd: leg.realizedPnlUsd,
    });
  }

  return [...grouped.values()].sort((a, b) => a.strategyName.localeCompare(b.strategyName));
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
      leverage: virtualStrategyRuns.leverage,
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
    leverage: number;
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

    const hsScopedRows = isHedgeScalpingStrategySlug(run.strategySlug)
      ? filterToLatestHsRunSegment(orderRows)
      : orderRows;
    const ledger = ordersToLedgerRows(hsScopedRows);
    const isHs = isHedgeScalpingStrategySlug(run.strategySlug);
    const label = userDisplayName(run.userEmail, run.userName);

    if (isHs && hsScopedRows.length > 0) {
      const d1Rows = hsScopedRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d1_"));
      const d2Rows = hsScopedRows.filter((r) => (r.correlationId ?? "").startsWith("hs_d2_"));
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
      leverage: Math.max(1, Number(run.leverage ?? "1")),
      openNetQty: String(run.openNetQty ?? "0"),
      openAvgEntryPrice: String(run.openAvgEntryPrice ?? "0"),
      openSymbol: run.openSymbol,
      orderRows: hsScopedRows.map((row) => ({
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
      leverage: userStrategyRuns.leverage,
      runSettingsJson: userStrategyRuns.runSettingsJson,
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
    leverage: number;
    runSettingsJson: unknown;
    positionNetQty: number;
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
      leverage: Math.max(1, Number(row.leverage ?? "1")),
      runSettingsJson: row.runSettingsJson,
      positionNetQty: Number(row.netQty ?? "0"),
    });
  }

  const hedgeByRunId = await loadHedgeScalpingVirtualRunsForOrderRowBundles(
    vctx.filter((c) => c.isHs).map((c) => ({ orderRows: c.orderRows })),
  );

  const markBySymbol = await fetchMarksForSymbols(symbolBatch);
  const contractValueBySymbol = await fetchContractValueBySymbol(symbolBatch, markBySymbol);

  for (const c of vctx) {
    if (c.isHs) {
      const hsHedgeId = firstHsD1HedgeRunIdFromOrders(c.orderRows);
      const hedgeRow = hsHedgeId ? (hedgeByRunId.get(hsHedgeId) ?? null) : null;
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
          contractValueBySymbol,
          leverage: c.leverage,
          hedgeSettings: c.hedgeSettings,
          hedgeRun: hedgeRow,
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
        contractValueBySymbol,
        leverage: c.leverage,
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
      contractValueBySymbol,
      leverage: r.leverage,
      symbolHint: r.symbol,
      overrideOpenNetQty: r.positionNetQty,
      qtyPctOfCapital:
        isHs && r.hedgeSettings
          ? account === "D2"
            ? r.hedgeSettings.d2QtyPctOfCapital
            : r.hedgeSettings.d1QtyPctOfCapital
          : null,
      activeClipCount: null,
    });
    if (!lr) continue;
    const tplAugmented = isTrendProfitLockScalpingStrategySlug(r.strategySlug)
      ? augmentTrendProfitLockLiveLeg(lr, r.runSettingsJson, boRows)
      : lr;
    const expandedTplLegs = isTrendProfitLockScalpingStrategySlug(r.strategySlug)
      ? expandTrendProfitLockLiveD2Legs(tplAugmented, r.runSettingsJson)
      : [tplAugmented];
    for (const legItem of expandedTplLegs) {
      legs.push(
        isHs && r.hedgeSettings
          ? augmentHedgeScalpingLegExitPrices(legItem, r.hedgeSettings)
          : legItem,
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
