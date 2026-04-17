import { and, eq, isNull, sql } from "drizzle-orm";

import { trendArbStrategyConfigSchema } from "@/lib/trend-arb-strategy-config";
import {
  classifyTrendArbAccount,
  deriveLedgerMetrics,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { db } from "@/server/db";
import { strategies, virtualBotOrders, virtualStrategyRuns } from "@/server/db/schema";
import {
  fetchDeltaIndiaPosition,
  fetchDeltaIndiaTickerMarkPrice,
} from "@/server/exchange/delta-india-positions";
import { hasTradingJobForCorrelationId } from "@/server/trading/execution-queue";
import { resolveDeltaIndiaProductId } from "@/server/trading/delta-symbol-to-product";
import { tradingLog } from "@/server/trading/trading-log";

import {
  dispatchTrendArbClosePrimary,
  dispatchTrendArbFlattenSecondary,
  dispatchTrendArbSecondaryHedgeClip,
} from "./trend-arb-dispatch";
import {
  clearHedgeStepsForRun,
  countHedgeStepsForRun,
  filterUnhedgedSteps,
  recordHedgeStep,
  clearVirtualHedgeStepsForRun,
  filterUnhedgedVirtualSteps,
  recordVirtualHedgeStep,
} from "./trend-arb-hedge-db";
import {
  getDeltaCredentialsForConnection,
  type TrendArbExecutionScope,
} from "./trend-arb-scope";
import type { TrendArbitrageEnv } from "./trend-arb-types";

const MIN_MS_PRIMARY_POLL = 2000;
const MIN_MS_TICKER = 1500;

const lastPrimaryPollAt = new Map<string, number>();
const lastTickerPollAt = new Map<string, number>();
// Step 0 is reserved for immediate initial hedge at crossover dispatch time.
const D2_FOLLOWUP_STEPS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Max favorable unrealized % seen while D1 was open (per run); reset when flat. */
const d1PeakUrpPct = new Map<string, number>();
/** Last D1 side while position was open — used to pick D2 flatten direction after D1 disappears. */
const lastD1SideWhileOpen = new Map<string, "long" | "short">();

async function loadLiveRiskSettings(strategyId: string, fallback: TrendArbitrageEnv["runtime"]): Promise<{
  stepMovePct: number;
  d2TargetProfitPct: number;
  d2StopLossPct: number;
  d2StepQtyPct: number;
  d1TargetProfitPct: number;
  d1StopLossPct: number;
}> {
  if (!db) {
    return {
      stepMovePct: Math.max(0.1, fallback.d2StepMovePct),
      d2TargetProfitPct: Math.max(0.1, fallback.d2TargetProfitPct),
      d2StopLossPct: Math.max(0.1, fallback.d2StopLossPct),
      d2StepQtyPct: Math.max(0, fallback.d2StepQtyPct),
      d1TargetProfitPct: Math.max(0.1, fallback.d1TargetProfitPct),
      d1StopLossPct: Math.max(0.1, fallback.d1StopLossPct),
    };
  }
  // NOTE: intentionally re-query DB every call (no in-memory cache) so mid-trade setting edits
  // like stepMovePct=0.15 are applied on the very next poll tick.
  const [row] = await db
    .select({ settingsJson: strategies.settingsJson })
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), isNull(strategies.deletedAt)))
    .limit(1);
  const parsed = trendArbStrategyConfigSchema.safeParse(row?.settingsJson ?? null);
  if (!parsed.success) {
    return {
      stepMovePct: Math.max(0.1, fallback.d2StepMovePct),
      d2TargetProfitPct: Math.max(0.1, fallback.d2TargetProfitPct),
      d2StopLossPct: Math.max(0.1, fallback.d2StopLossPct),
      d2StepQtyPct: Math.max(0, fallback.d2StepQtyPct),
      d1TargetProfitPct: Math.max(0.1, fallback.d1TargetProfitPct),
      d1StopLossPct: Math.max(0.1, fallback.d1StopLossPct),
    };
  }
  return {
    stepMovePct: Math.max(0.1, parsed.data.delta2.stepMovePct),
    d2TargetProfitPct: Math.max(0.1, parsed.data.delta2.targetProfitPct),
    d2StopLossPct: Math.max(0.1, parsed.data.delta2.stopLossPct),
    d2StepQtyPct: Math.max(0, parsed.data.delta2.stepQtyPct),
    d1TargetProfitPct: Math.max(0.1, parsed.data.delta1.targetProfitPct),
    d1StopLossPct: Math.max(0.1, parsed.data.delta1.stopLossPct),
  };
}

async function readVirtualNetForRun(runId: string): Promise<number | null> {
  if (!db) return null;
  const [run] = await db
    .select({ openNetQty: virtualStrategyRuns.openNetQty })
    .from(virtualStrategyRuns)
    .where(eq(virtualStrategyRuns.id, runId))
    .limit(1);
  if (!run) return null;
  const openNetQty = Number(run.openNetQty ?? "0");
  const [agg] = await db
    .select({
      net: sql<number>`COALESCE(SUM(
        CASE
          WHEN ${virtualBotOrders.side} = 'buy' THEN cast(${virtualBotOrders.quantity} as numeric)
          WHEN ${virtualBotOrders.side} = 'sell' THEN -cast(${virtualBotOrders.quantity} as numeric)
          ELSE 0
        END
      ), 0)::float8`,
    })
    .from(virtualBotOrders)
    .where(eq(virtualBotOrders.virtualRunId, runId));
  const ledgerNet = Number(agg?.net ?? 0);
  return Number.isFinite(openNetQty) ? openNetQty : ledgerNet;
}

async function readVirtualTrendArbLegState(runId: string): Promise<{
  d1NetQty: number;
  d2NetQty: number;
  d1EntryPrice: number | null;
  d2Symbol: string | null;
}> {
  if (!db) return { d1NetQty: 0, d2NetQty: 0, d1EntryPrice: null, d2Symbol: null };
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
    .where(eq(virtualBotOrders.virtualRunId, runId))
    .orderBy(virtualBotOrders.createdAt);

  const ledger: LedgerOrderRow[] = orderRows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    quantity: String(row.quantity),
    fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
    status: row.status,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  }));
  const d1Orders = ledger.filter((order) => classifyTrendArbAccount(order) === "primary");
  const d2Orders = ledger.filter((order) => classifyTrendArbAccount(order) === "secondary");
  const d1 = deriveLedgerMetrics(d1Orders, null);
  const d2 = deriveLedgerMetrics(d2Orders, null);
  return {
    d1NetQty: d1.openNetQty,
    d2NetQty: d2.openNetQty,
    d1EntryPrice: d1.avgEntryPrice,
    d2Symbol: d2.openSymbol,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function throttlePrimaryPoll(runId: string): Promise<void> {
  const last = lastPrimaryPollAt.get(runId) ?? 0;
  const now = Date.now();
  const wait = MIN_MS_PRIMARY_POLL - (now - last);
  if (wait > 0) await sleep(wait);
  lastPrimaryPollAt.set(runId, Date.now());
}

async function throttleTicker(key: string): Promise<void> {
  const last = lastTickerPollAt.get(key) ?? 0;
  const now = Date.now();
  const wait = MIN_MS_TICKER - (now - last);
  if (wait > 0) await sleep(wait);
  lastTickerPollAt.set(key, now);
}

function unrealizedProfitPercent(params: {
  markPrice: number;
  entryPrice: number;
  side: "long" | "short";
}): number {
  const { markPrice, entryPrice, side } = params;
  if (!(entryPrice > 0) || !Number.isFinite(markPrice)) return 0;
  const raw = ((markPrice - entryPrice) / entryPrice) * 100;
  return side === "long" ? raw : -raw;
}

export type TrendArbPollResult = {
  primaryFlat: boolean;
  detail: string;
};

async function monitorActiveVirtualRuns(params: {
  env: TrendArbitrageEnv;
  barTime: number;
  markPrice: number;
}): Promise<string[]> {
  const { env, barTime, markPrice } = params;
  if (!db) return [];
  const rows = await db
    .select({
      runId: virtualStrategyRuns.id,
      userId: virtualStrategyRuns.userId,
      openNetQty: virtualStrategyRuns.openNetQty,
      openAvgEntryPrice: virtualStrategyRuns.openAvgEntryPrice,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.strategyId, env.strategyId),
        eq(virtualStrategyRuns.status, "active"),
      ),
    );

  const parts: string[] = [];
  for (const r of rows) {
    const legState = await readVirtualTrendArbLegState(r.runId);
    const d1NetQty = legState.d1NetQty;
    const d2NetQty = legState.d2NetQty;
    const entry = legState.d1EntryPrice ?? Number(r.openAvgEntryPrice ?? "0");

    if (Math.abs(d1NetQty) <= 1e-8 && Math.abs(d2NetQty) > 1e-8) {
      console.log(`[VIRTUAL-CLEANUP] D1 is flat. Flattening orphaned D2 position for run ${r.runId}`);
      const flattenSide = d2NetQty > 0 ? "sell" : "buy";
      const cleanup = await dispatchTrendArbFlattenSecondary({
        strategyId: env.strategyId,
        symbol: legState.d2Symbol ?? r.openSymbol ?? env.runtime.symbol,
        reason: "virtual_primary_flat_cleanup",
        nonce: `virtual_d2_cleanup_${r.runId}_${Date.now()}`,
        markPrice,
        targetUserIds: [r.userId],
        quantity: String(Math.abs(d2NetQty)),
        flattenSide,
      });
      if (cleanup.ok && cleanup.jobsEnqueued > 0) {
        await clearVirtualHedgeStepsForRun(r.runId);
        parts.push(`vcleanup:${r.runId}:jobs${cleanup.jobsEnqueued}`);
      } else {
        parts.push(`vcleanup_skip:${r.runId}:${cleanup.ok ? "zero_jobs" : cleanup.error}`);
      }
      continue;
    }

    if (!(Math.abs(d1NetQty) > 1e-8) || !(entry > 0)) continue;
    const d1Side: "long" | "short" = d1NetQty > 0 ? "long" : "short";
    console.log(
      `[MONITORING-VIRTUAL] Run ${r.runId} is Active. Checking D2 triggers...`,
    );

    const pending = await filterUnhedgedVirtualSteps(r.runId, D2_FOLLOWUP_STEPS);
    for (const step of pending) {
      const latestRisk = await loadLiveRiskSettings(env.strategyId, env.runtime);
      const needMovePct = step * latestRisk.stepMovePct;
      const nextStepTarget =
        d1Side === "long"
          ? entry * (1 + needMovePct / 100)
          : entry * (1 - needMovePct / 100);
      console.log(
        `[D2-MATH] Run: ${r.runId} | Side: ${d1Side} | Entry: ${entry.toFixed(2)} | LiveStepPct: ${latestRisk.stepMovePct}% | TargetPrice: ${nextStepTarget.toFixed(2)} | CurrentPrice: ${markPrice.toFixed(2)}`,
      );
      const crossed =
        d1Side === "long"
          ? markPrice >= nextStepTarget
          : markPrice <= nextStepTarget;
      if (!crossed) continue;
      console.log(
        `[D2-TRIGGER] Mark ${markPrice.toFixed(2)} has crossed target ${nextStepTarget.toFixed(2)}. Enqueueing hedge...`,
      );
      const correlationId = `ta_trendarb_${env.strategyId}_v_${r.runId}_s${step}_${Date.now()}`;
      if (await hasTradingJobForCorrelationId(correlationId)) continue;
      const clipRes = await dispatchTrendArbSecondaryHedgeClip({
        strategyId: env.strategyId,
        symbol: r.openSymbol ?? env.runtime.symbol,
        candleTime: barTime,
        stepIndex: step,
        side: d1Side === "long" ? "short" : "long",
        forceSide: d1Side === "long" ? "short" : "long",
        markPrice,
        quantity: env.runtime.d2StepQty,
        stepQtyPct: latestRisk.d2StepQtyPct,
        targetProfitPct: latestRisk.d2TargetProfitPct,
        targetUserIds: [r.userId],
        correlationIdOverride: correlationId,
      });
      if (clipRes.ok && clipRes.jobsEnqueued > 0) {
        await recordVirtualHedgeStep(r.runId, step);
        parts.push(`vhedge:${r.runId}:s${step}`);
      } else {
        tradingLog("warn", "ta_trend_arb_virtual_hedge_skip", {
          runId: r.runId,
          step,
          error: clipRes.ok ? "zero_jobs" : clipRes.error,
        });
      }
    }
  }
  return parts;
}

/**
 * Stateful poll: primary position, D1 soft/hard risk exits, Delta 2 grid hedges, D2 cleanup when D1 flat.
 * Swallows venue/DB errors — returns `primaryFlat: true` on read failure so we do not stack entries blindly.
 */
export async function pollTrendArbRiskAndHedges(params: {
  env: TrendArbitrageEnv;
  scope: TrendArbExecutionScope;
  barTime: number;
  barClose: number;
}): Promise<TrendArbPollResult> {
  const { env, scope, barTime, barClose } = params;
  const parts: string[] = [];
  const clip = Number(env.runtime.d2StepQty) || 100;

  try {
    await throttlePrimaryPoll(scope.runId);

    const virtualNet = await readVirtualNetForRun(scope.runId);
    if (virtualNet != null && Math.abs(virtualNet) > 1e-8) {
      console.log(`[STATE-SYNC] Detected active position of ${virtualNet}. Switching to D2 monitoring.`);
      return { primaryFlat: false, detail: `virtual_active_${virtualNet}` };
    }

    const cred = await getDeltaCredentialsForConnection({
      userId: scope.userId,
      connectionId: scope.primaryExchangeConnectionId,
    });
    if (!cred.ok) {
      tradingLog("warn", "ta_trend_arb_primary_creds", {
        runId: scope.runId,
        error: cred.error,
      });
      return { primaryFlat: true, detail: `primary_creds:${cred.error}` };
    }

    const product = await resolveDeltaIndiaProductId(env.runtime.symbol);
    if (!product.ok) {
      tradingLog("warn", "ta_trend_arb_product", {
        symbol: env.runtime.symbol,
        error: product.error,
      });
      return { primaryFlat: true, detail: `product:${product.error}` };
    }

    const posRes = await fetchDeltaIndiaPosition({
      apiKey: cred.apiKey,
      apiSecret: cred.apiSecret,
      productId: product.productId,
    });
    if (!posRes.ok) {
      tradingLog("warn", "ta_trend_arb_position_fetch", {
        runId: scope.runId,
        error: posRes.error,
      });
      return { primaryFlat: true, detail: `position_fetch:${posRes.error}` };
    }

    const pos = posRes.position;
    if (!pos.open) {
      d1PeakUrpPct.delete(scope.runId);
      const hedgeN = await countHedgeStepsForRun(scope.runId);
      const d1Was = lastD1SideWhileOpen.get(scope.runId) ?? "long";
      if (hedgeN > 0 && scope.secondaryExchangeConnectionId) {
        const nonce = `d1flat_${barTime}_${Date.now()}`;
        const flattenSide = d1Was === "long" ? "buy" : "sell";
        const qty = String(Math.min(900, hedgeN * clip));
        const flat = await dispatchTrendArbFlattenSecondary({
          strategyId: env.strategyId,
          symbol: env.runtime.symbol,
          reason: "primary_flat_cleanup",
          nonce,
          markPrice: barClose,
          targetUserIds: [scope.userId],
          targetRunIds: [scope.runId],
          flattenSide,
          quantity: qty,
        });
        tradingLog("info", "ta_trend_arb_flatten_secondary", {
          runId: scope.runId,
          jobs: flat.ok ? flat.jobsEnqueued : 0,
          error: flat.ok ? undefined : flat.error,
        });
        await clearHedgeStepsForRun(scope.runId);
        parts.push(`flatten_d2_jobs:${flat.ok ? flat.jobsEnqueued : 0}`);
      } else if (hedgeN > 0) {
        await clearHedgeStepsForRun(scope.runId);
        parts.push("d2_flatten_skipped_no_secondary");
      }
      lastD1SideWhileOpen.delete(scope.runId);
      return { primaryFlat: true, detail: parts.join("|") || "primary_flat" };
    }

    lastD1SideWhileOpen.set(scope.runId, pos.side);

    let mark = pos.markPrice;
    if (mark == null || !(mark > 0)) {
      await throttleTicker(`${scope.runId}_ticker`);
      mark =
        (await fetchDeltaIndiaTickerMarkPrice({ symbol: env.runtime.symbol })) ?? barClose;
    }
    if (!(mark > 0)) mark = barClose;

    const urp = unrealizedProfitPercent({
      markPrice: mark,
      entryPrice: pos.entryPrice,
      side: pos.side,
    });

    const prevPeak = d1PeakUrpPct.get(scope.runId) ?? urp;
    const peak = Math.max(prevPeak, urp);
    d1PeakUrpPct.set(scope.runId, peak);

    const d1Side = pos.side;
    const liveRisk = await loadLiveRiskSettings(env.strategyId, env.runtime);
    const d1Sl = liveRisk.d1StopLossPct;
    const d1Tp = liveRisk.d1TargetProfitPct;
    const liveStepMovePct = liveRisk.stepMovePct;

    const hardSlHit = urp <= -d1Sl;
    const hardTpHit = urp >= d1Tp;
    const softBeHit = peak >= Math.max(0.1, d1Tp / 2) && urp <= 0;

    let monD2 = "D2: n/a (no secondary exchange)";
    if (scope.secondaryExchangeConnectionId) {
      const pendingSteps = await filterUnhedgedSteps(scope.runId, D2_FOLLOWUP_STEPS);
      if (pendingSteps.length === 0) {
        monD2 = "D2: all hedge steps (1–9) recorded";
      } else {
        const nextStep = Math.min(...pendingSteps);
        const needMovePct = nextStep * liveStepMovePct;
        const nextStepTargetPx =
          pos.side === "long"
            ? pos.entryPrice * (1 + needMovePct / 100)
            : pos.entryPrice * (1 - needMovePct / 100);
        const remainingMovePct =
          mark > 0 ? Math.abs(((nextStepTargetPx - mark) / mark) * 100) : NaN;
        monD2 = `next D2 step ${nextStep} at ~${nextStepTargetPx.toFixed(2)} (step ${liveStepMovePct}% x ${nextStep}, remaining ${Number.isFinite(remainingMovePct) ? remainingMovePct.toFixed(2) : "N/A"}%)`;
      }
    }

    const toTgt = d1Tp - urp;
    console.log(
      `[MONITORING] Trade #${scope.runId}: ${d1Side.toUpperCase()} mark ${mark.toFixed(2)}, entry ${pos.entryPrice.toFixed(2)}, Current PnL: ${urp >= 0 ? "+" : ""}${urp.toFixed(2)}%, D1 target +${d1Tp}% (${toTgt >= 0 ? "+" : ""}${toTgt.toFixed(2)}% to target), ${monD2}`,
    );

    console.log(
      `[EXIT-CHECK] Trade #${scope.runId}: D1 — URP ${urp.toFixed(2)}% (SL ≤-${d1Sl}%, TP +${d1Tp}%, peak ${peak.toFixed(2)}%) | hard_sl=${hardSlHit} hard_tp=${hardTpHit} soft_be=${softBeHit}`,
    );

    if (hardSlHit || hardTpHit || softBeHit) {
      const reason = hardSlHit
        ? `hard_sl_${d1Sl}pct`
        : hardTpHit
          ? `hard_tp_${d1Tp}pct`
          : "soft_be_trail";
      const nonce = `${reason}_${Date.now()}`;
      const closeSide = d1Side === "long" ? "sell" : "buy";
      const res = await dispatchTrendArbClosePrimary({
        strategyId: env.strategyId,
        symbol: env.runtime.symbol,
        quantity: String(pos.size),
        side: closeSide,
        markPrice: mark,
        targetUserIds: [scope.userId],
        targetRunIds: [scope.runId],
        correlationNonce: nonce,
        metadataReason: reason,
      });
      tradingLog("info", "ta_trend_arb_close_primary", {
        runId: scope.runId,
        reason,
        urp,
        peak,
        jobs: res.ok ? res.jobsEnqueued : 0,
      });
      if (hardSlHit) {
        tradingLog("warn", "ta_trend_arb_stop_loss_hit", {
          runId: scope.runId,
          delta: 1,
          message: `Stop Loss hit for Delta 1. Exiting position at ${mark}.`,
        });
      }
      parts.push(`close_d1:${reason}`);
      return { primaryFlat: false, detail: parts.join("|") };
    }

    if (scope.secondaryExchangeConnectionId) {
      const secondaryCreds = await getDeltaCredentialsForConnection({
        userId: scope.userId,
        connectionId: scope.secondaryExchangeConnectionId,
      });
      if (secondaryCreds.ok) {
        const d2PosRes = await fetchDeltaIndiaPosition({
          apiKey: secondaryCreds.apiKey,
          apiSecret: secondaryCreds.apiSecret,
          productId: product.productId,
        });
        if (d2PosRes.ok && d2PosRes.position.open) {
          const d2Mark = d2PosRes.position.markPrice ?? mark;
          const d2Urp = unrealizedProfitPercent({
            markPrice: d2Mark,
            entryPrice: d2PosRes.position.entryPrice,
            side: d2PosRes.position.side,
          });
          const d2Sl = liveRisk.d2StopLossPct;
          console.log(
            `[EXIT-CHECK] Trade #${scope.runId}: D2 — URP ${d2Urp.toFixed(2)}% vs stop −${d2Sl}% (mark ${d2Mark.toFixed(2)})`,
          );
          if (d2Urp <= -d2Sl) {
            const nonce = `d2_stop_loss_${Date.now()}`;
            const flattenSide = d2PosRes.position.side === "long" ? "sell" : "buy";
            const flat = await dispatchTrendArbFlattenSecondary({
              strategyId: env.strategyId,
              symbol: env.runtime.symbol,
              reason: "secondary_stop_loss",
              nonce,
              markPrice: d2Mark,
              targetUserIds: [scope.userId],
              targetRunIds: [scope.runId],
              flattenSide,
              quantity: String(d2PosRes.position.size),
            });
            tradingLog("warn", "ta_trend_arb_stop_loss_hit", {
              runId: scope.runId,
              delta: 2,
              message: `Stop Loss hit for Delta 2. Exiting position at ${d2Mark}.`,
              jobs: flat.ok ? flat.jobsEnqueued : 0,
            });
            parts.push("close_d2:stop_loss");
          }
        }
      }
    }

    if (scope.secondaryExchangeConnectionId) {
      const pending = await filterUnhedgedSteps(scope.runId, D2_FOLLOWUP_STEPS);
      for (const step of pending) {
        const latestRisk = await loadLiveRiskSettings(env.strategyId, env.runtime);
        const needMovePct = step * latestRisk.stepMovePct;
        const nextStepTarget =
          d1Side === "long"
            ? pos.entryPrice * (1 + needMovePct / 100)
            : pos.entryPrice * (1 - needMovePct / 100);
        console.log(
          `[D2-MATH] Run: ${scope.runId} | Side: ${d1Side} | Entry: ${pos.entryPrice.toFixed(2)} | LiveStepPct: ${latestRisk.stepMovePct}% | TargetPrice: ${nextStepTarget.toFixed(2)} | CurrentPrice: ${mark.toFixed(2)}`,
        );
        const crossed =
          d1Side === "long"
            ? mark >= nextStepTarget
            : mark <= nextStepTarget;
        if (!crossed) {
          continue;
        }
        console.log(
          `[D2-TRIGGER] Mark ${mark.toFixed(2)} has crossed target ${nextStepTarget.toFixed(2)} for step ${step}. Enqueueing hedge...`,
        );
        const correlationId = `ta_trendarb_${env.strategyId}_d2_${scope.runId}_s${step}_${Date.now()}`;
        if (await hasTradingJobForCorrelationId(correlationId)) continue;

        const clipRes = await dispatchTrendArbSecondaryHedgeClip({
          strategyId: env.strategyId,
          symbol: env.runtime.symbol,
          candleTime: barTime,
          stepIndex: step,
          side: d1Side === "long" ? "short" : "long",
          forceSide: d1Side === "long" ? "short" : "long",
          markPrice: mark,
          quantity: env.runtime.d2StepQty,
          stepQtyPct: latestRisk.d2StepQtyPct,
          targetProfitPct: latestRisk.d2TargetProfitPct,
          targetUserIds: [scope.userId],
          targetRunIds: [scope.runId],
          correlationIdOverride: correlationId,
        });
        if (clipRes.ok && clipRes.jobsEnqueued > 0) {
          await recordHedgeStep(scope.runId, step);
          parts.push(`hedge_s${step}`);
        } else {
          tradingLog("warn", "ta_trend_arb_hedge_skip", {
            runId: scope.runId,
            step,
            error: clipRes.ok ? "zero_jobs" : clipRes.error,
          });
        }
      }
    }

    return {
      primaryFlat: false,
      detail: parts.join("|") || `d1_open_urp_${urp.toFixed(2)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "ta_trend_arb_poll_exception", { runId: scope.runId, error: msg });
    return { primaryFlat: true, detail: `poll_exception:${msg}` };
  }
}

export async function pollTrendArbVirtualRiskAndHedges(params: {
  env: TrendArbitrageEnv;
  barTime: number;
  barClose: number;
}): Promise<{ detail: string }> {
  try {
    const parts = await monitorActiveVirtualRuns({
      env: params.env,
      barTime: params.barTime,
      markPrice: params.barClose,
    });
    return { detail: parts.join("|") || "virtual_monitor_ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tradingLog("warn", "ta_trend_arb_virtual_poll_exception", { error: msg });
    return { detail: `virtual_poll_exception:${msg}` };
  }
}
