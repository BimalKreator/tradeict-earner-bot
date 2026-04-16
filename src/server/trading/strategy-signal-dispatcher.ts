import {
  findEligibleRunsForStrategyExecution,
  type EligibleStrategyRunRow,
} from "./eligibility";
import { findEligibleVirtualRunsForStrategyExecution } from "./virtual-eligibility";
import { enqueueStrategySignalJobs } from "./execution-queue";
import { normalizeStrategySignalAction } from "./signal-action";
import type {
  StrategyExecutionSignal,
  StrategySignalIntakeResponse,
} from "./signals/types";
import { tradingLog } from "./trading-log";
import type { TradingExecutionJobPayload } from "@/server/db/schema";

type TrendArbSizingMeta = {
  mode: "capital_split_50_50";
  leg: "d1_entry" | "d2_step";
  qtyPct: number;
};

function resolveLiveExchangeConnectionId(
  r: EligibleStrategyRunRow,
  venue: StrategyExecutionSignal["exchangeVenue"] | undefined,
): string | null {
  const v = venue ?? "auto";
  if (v === "secondary") {
    return r.secondaryExchangeConnectionId;
  }
  if (v === "primary") {
    return r.primaryExchangeConnectionId ?? r.exchangeConnectionId;
  }
  return r.exchangeConnectionId;
}

function mergeSignalMetadata(
  signal: StrategyExecutionSignal,
): Record<string, unknown> {
  const base =
    signal.metadata && typeof signal.metadata === "object"
      ? { ...signal.metadata }
      : {};
  if (base.mark_price == null && base.markPrice != null) {
    base.mark_price = base.markPrice;
  }
  return base;
}

function parsePositiveNumber(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readTrendArbSizing(meta: Record<string, unknown>): TrendArbSizingMeta | null {
  const s = meta.trend_arb_sizing;
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const rec = s as Record<string, unknown>;
  const mode = rec.mode === "capital_split_50_50" ? "capital_split_50_50" : null;
  const leg = rec.leg === "d1_entry" || rec.leg === "d2_step" ? rec.leg : null;
  const qtyPct = parsePositiveNumber(rec.qtyPct);
  if (!mode || !leg || qtyPct == null) return null;
  return { mode, leg, qtyPct };
}

function resolveMarkPrice(meta: Record<string, unknown>, limitPrice?: string | null): number | null {
  const m = parsePositiveNumber(meta.mark_price ?? meta.markPrice ?? meta.last_price ?? meta.lastPrice);
  if (m != null) return m;
  return parsePositiveNumber(limitPrice ?? null);
}

function normalizeTrendArbPct(rawPct: number): number {
  if (!Number.isFinite(rawPct) || rawPct <= 0) return 0;
  // If a decimal slipped through (e.g. 0.1 meaning 10%), normalize it.
  return rawPct <= 1 ? rawPct * 100 : rawPct;
}

function computeTrendArbSizedQuantity(params: {
  fallbackQuantity: string;
  totalCapitalUsd: string;
  markPrice: number | null;
  sizing: TrendArbSizingMeta | null;
}): string {
  const cap = parsePositiveNumber(params.totalCapitalUsd);
  const mark = params.markPrice;
  if (!params.sizing || cap == null || mark == null || mark <= 0) return params.fallbackQuantity;
  const totalStrategyCapital = cap;
  const baseCapitalUsd = totalStrategyCapital * 0.5;
  const stepQtyPct = normalizeTrendArbPct(params.sizing.qtyPct);
  const pctDecimal = Number(stepQtyPct) / 100;
  const notionalTargetUsd = baseCapitalUsd * pctDecimal;
  const qty = notionalTargetUsd / mark;
  if (!(Number.isFinite(qty) && qty > 0)) return params.fallbackQuantity;
  // Exchange lot-size-safe fallback rounding.
  return qty.toFixed(6);
}

/**
 * Entry point for future strategy signal providers (cron, websocket, ML, etc.).
 * Fans out one durable job per eligible **live** user run and per eligible **virtual** run.
 */
export async function dispatchStrategyExecutionSignal(
  signal: StrategyExecutionSignal,
): Promise<StrategySignalIntakeResponse> {
  if (!signal.strategyId || !signal.correlationId) {
    return { ok: false, error: "strategyId and correlationId are required." };
  }
  if (!signal.quantity?.trim()) {
    return { ok: false, error: "quantity is required." };
  }

  const signalAction = normalizeStrategySignalAction(signal);
  const signalMetadata = mergeSignalMetadata(signal);
  const trendArbSizing = readTrendArbSizing(signalMetadata);
  const markPrice = resolveMarkPrice(signalMetadata, signal.limitPrice ?? null);

  const [liveRuns, virtualRuns] = await Promise.all([
    findEligibleRunsForStrategyExecution(signal.strategyId, {
      targetUserIds: signal.targetUserIds,
      targetRunIds: signal.targetRunIds,
      signalAction,
    }),
    findEligibleVirtualRunsForStrategyExecution(signal.strategyId, {
      targetUserIds: signal.targetUserIds,
      signalAction,
    }),
  ]);

  const venue = signal.exchangeVenue;
  const livePayloads: TradingExecutionJobPayload[] = [];
  for (const r of liveRuns) {
    const exchangeConnectionId = resolveLiveExchangeConnectionId(r, venue);
    if (exchangeConnectionId == null) continue;
    livePayloads.push({
      kind: "execute_strategy_signal",
      executionMode: "live",
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
      symbol: signal.symbol,
      side: signal.side,
      orderType: signal.orderType,
      quantity: computeTrendArbSizedQuantity({
        fallbackQuantity: signal.quantity,
        totalCapitalUsd: r.capitalToUseInr,
        markPrice,
        sizing: trendArbSizing,
      }),
      limitPrice: signal.limitPrice ?? null,
      targetUserId: r.userId,
      subscriptionId: r.subscriptionId,
      runId: r.runId,
      exchangeConnectionId,
      signalAction,
      signalMetadata,
    });
  }

  const virtualPayloads: TradingExecutionJobPayload[] = virtualRuns.map(
    (v) => ({
      kind: "execute_strategy_signal",
      executionMode: "virtual",
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
      symbol: signal.symbol,
      side: signal.side,
      orderType: signal.orderType,
      quantity: computeTrendArbSizedQuantity({
        fallbackQuantity: signal.quantity,
        totalCapitalUsd: v.virtualCapitalUsd,
        markPrice,
        sizing: trendArbSizing,
      }),
      limitPrice: signal.limitPrice ?? null,
      targetUserId: v.userId,
      virtualRunId: v.virtualRunId,
      signalAction,
      signalMetadata,
    }),
  );

  const payloads = [...livePayloads, ...virtualPayloads];

  if (payloads.length === 0) {
    tradingLog("info", "signal_dispatch_no_targets", {
      strategyId: signal.strategyId,
      correlationId: signal.correlationId,
    });
    return { ok: true, jobsEnqueued: 0, correlationId: signal.correlationId };
  }

  const n = await enqueueStrategySignalJobs(payloads);
  tradingLog("info", "signal_dispatch_enqueued", {
    strategyId: signal.strategyId,
    correlationId: signal.correlationId,
    jobsEnqueued: n,
    liveJobs: livePayloads.length,
    virtualJobs: virtualPayloads.length,
  });

  return { ok: true, jobsEnqueued: n, correlationId: signal.correlationId };
}
