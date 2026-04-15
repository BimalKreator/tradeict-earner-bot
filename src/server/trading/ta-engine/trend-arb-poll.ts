import {
  fetchDeltaIndiaPosition,
  fetchDeltaIndiaTickerMarkPrice,
} from "@/server/exchange/delta-india-positions";
import { hasTradingJobForCorrelationId } from "@/server/trading/execution-queue";
import { resolveDeltaIndiaProductId } from "@/server/trading/delta-symbol-to-product";
import { tradingLog } from "@/server/trading/trading-log";

import { TREND_ARB_SECONDARY_CLIP_QTY } from "./trend-arb-constants";
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

/** Max favorable unrealized % seen while D1 was open (per run); reset when flat. */
const d1PeakUrpPct = new Map<string, number>();
/** Last D1 side while position was open — used to pick D2 flatten direction after D1 disappears. */
const lastD1SideWhileOpen = new Map<string, "long" | "short">();

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
  const clip = Number(TREND_ARB_SECONDARY_CLIP_QTY) || 100;

  try {
    await throttlePrimaryPoll(scope.runId);

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

    const product = await resolveDeltaIndiaProductId(env.symbol);
    if (!product.ok) {
      tradingLog("warn", "ta_trend_arb_product", { symbol: env.symbol, error: product.error });
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
          symbol: env.symbol,
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
        (await fetchDeltaIndiaTickerMarkPrice({ symbol: env.symbol })) ?? barClose;
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

    const hardSlHit = urp <= -3;
    const hardTpHit = urp >= 10;
    const softBeHit = peak >= 5 && urp <= 0;

    if (hardSlHit || hardTpHit || softBeHit) {
      const reason = hardSlHit ? "hard_sl_3pct" : hardTpHit ? "hard_tp_10pct" : "soft_be_trail";
      const nonce = `${reason}_${Date.now()}`;
      const closeSide = d1Side === "long" ? "sell" : "buy";
      const res = await dispatchTrendArbClosePrimary({
        strategyId: env.strategyId,
        symbol: env.symbol,
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
      parts.push(`close_d1:${reason}`);
      return { primaryFlat: false, detail: parts.join("|") };
    }

    if (scope.secondaryExchangeConnectionId && urp >= 1) {
      const maxStep = Math.min(9, Math.floor(urp));
      const candidates: number[] = [];
      for (let s = 1; s <= maxStep; s++) candidates.push(s);
      const pending = await filterUnhedgedSteps(scope.runId, candidates);
      for (const step of pending) {
        const correlationId = `ta_trendarb_${env.strategyId}_d2_${scope.runId}_s${step}_${Date.now()}`;
        if (await hasTradingJobForCorrelationId(correlationId)) continue;

        const clipRes = await dispatchTrendArbSecondaryHedgeClip({
          strategyId: env.strategyId,
          symbol: env.symbol,
          candleTime: barTime,
          stepIndex: step,
          d1Side,
          markPrice: mark,
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
