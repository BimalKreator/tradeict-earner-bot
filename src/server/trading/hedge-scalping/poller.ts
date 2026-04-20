import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  isHedgeScalpingStrategySlug,
  parseAllowedSymbolsList,
  type HedgeScalpingConfig,
} from "@/lib/hedge-scalping-config";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";
import { extractHedgeScalpingSymbolFromRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { db } from "@/server/db";
import {
  hedgeScalpingVirtualClips,
  hedgeScalpingVirtualRuns,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  virtualStrategyRuns,
} from "@/server/db/schema";

import type { Candle } from "@/server/trading/ta-engine/indicators/halftrend";
import { dispatchStrategyExecutionSignal } from "@/server/trading/strategy-signal-dispatcher";

import {
  d1ContinuousTrailedStopPrice,
  d1FavorableDistancePct,
  d1HardStopPrice,
  d2LadderFavorableBandFloor,
  evaluateHedgeScalpingState,
  hedgeScalpingD2Side,
  maxD2LadderStepInclusive,
} from "./engine-math";
import { parseHedgeScalpingStrategySettings } from "./load-hedge-scalping-config";
import { analyzeHedgeScalpingSignal } from "./signal-detector";
import type {
  D2ClipState,
  HedgeScalpingIntent,
  HedgeScalpingRunState,
} from "./types";
import {
  applyHsVirtualBalanceDelta,
  computeHedgeScalpingD1Qty,
  computeHedgeScalpingD2StepQty,
  fetchActiveClipForStep,
  fetchHedgeRunRow,
  hedgeCloseSide,
  hedgeLegGrossPnlUsd,
  hedgeOpenSide,
  hedgeSizingBalanceUsd,
  hedgeVirtualRoundtripFeeUsd,
  type HedgeScalpingDbTx,
  hsCorrelationD1Entry,
  hsCorrelationD1Exit,
  hsCorrelationD2Entry,
  hsCorrelationD2Exit,
  insertHsVirtualFilledOrder,
  loadVirtualPaperRunForSizing,
  resolveVirtualPaperRunId,
} from "./virtual-integration";

const LOG = "[HS-POLLER]";

/** Mark for the user’s venue symbol; avoids sizing with the worker’s candle mark when symbols differ. */
async function hedgeScalpingMarkUsdOrFallback(
  symbol: string | null | undefined,
  workerMark: number,
): Promise<number> {
  const sym = symbol?.trim();
  if (!sym) return workerMark;
  const px = await fetchDeltaIndiaTickerMarkPrice({ symbol: sym });
  if (px != null && Number.isFinite(px) && px > 0) return px;
  return workerMark;
}

function num(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(8) : String(n);
}

type PendingLiveSignal = {
  correlationId: string;
  strategyId: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  markPrice: number;
  actionType: "entry" | "exit";
  metadata?: Record<string, unknown>;
};

async function dispatchPendingHsLiveSignals(
  signals: PendingLiveSignal[],
): Promise<void> {
  for (const s of signals) {
    try {
      const res = await dispatchStrategyExecutionSignal({
        strategyId: s.strategyId,
        correlationId: s.correlationId,
        symbol: s.symbol,
        side: s.side,
        orderType: "market",
        quantity: s.quantity,
        actionType: s.actionType,
        executionMode: "live_only",
        targetUserIds: [s.userId],
        metadata: {
          source: "hedge_scalping_poller",
          mark_price: s.markPrice,
          ...(s.metadata ?? {}),
        },
      });
      if (!res.ok) {
        console.warn(
          `${LOG} live dispatch failed correlation=${s.correlationId} strategy=${s.strategyId} user=${s.userId} err=${res.error}`,
        );
      } else {
        console.log(
          `${LOG} live dispatch ok correlation=${s.correlationId} strategy=${s.strategyId} user=${s.userId} jobs=${res.jobsEnqueued} live=${res.liveJobsEnqueued ?? 0}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `${LOG} live dispatch exception correlation=${s.correlationId} strategy=${s.strategyId} user=${s.userId} err=${msg.slice(0, 400)}`,
      );
    }
  }
}

async function resolveHedgeScalpingTradingSymbol(
  tx: HedgeScalpingDbTx,
  userId: string,
  strategyId: string,
  cfg: HedgeScalpingConfig,
): Promise<string | null> {
  const allowed = parseAllowedSymbolsList(cfg.general.allowedSymbols);
  if (allowed.length === 0) return null;
  const allowedSet = new Set(allowed.map((s) => s.toUpperCase()));

  const [usrRow] = await tx
    .select({ json: userStrategyRuns.runSettingsJson })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        eq(userStrategySubscriptions.strategyId, strategyId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  const fromUsr = extractHedgeScalpingSymbolFromRunSettingsJson(usrRow?.json);
  if (fromUsr && allowedSet.has(fromUsr.toUpperCase())) {
    return fromUsr.toUpperCase();
  }

  const [vRow] = await tx
    .select({ json: virtualStrategyRuns.runSettingsJson })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.userId, userId),
        eq(virtualStrategyRuns.strategyId, strategyId),
        eq(virtualStrategyRuns.status, "active"),
      ),
    )
    .limit(1);

  const fromVirtual = extractHedgeScalpingSymbolFromRunSettingsJson(vRow?.json);
  if (fromVirtual && allowedSet.has(fromVirtual.toUpperCase())) {
    return fromVirtual.toUpperCase();
  }

  return allowed[0]!.toUpperCase();
}

function mergeMaxFavorable(
  d1Side: "LONG" | "SHORT",
  current: number,
  mark: number,
): number {
  if (!(mark > 0) || !Number.isFinite(mark)) return current;
  if (d1Side === "LONG") {
    return Math.max(current, mark);
  }
  return Math.min(current, mark);
}

function d2ClipStateFromRow(
  clip: {
    stepLevel: number;
    entryPrice: string;
    side: "LONG" | "SHORT";
  },
  cfg: HedgeScalpingConfig,
): D2ClipState {
  const entry = num(clip.entryPrice);
  const tp = cfg.delta2.targetProfitPct / 100;
  const sl = cfg.delta2.stopLossPct / 100;
  if (clip.side === "LONG") {
    return {
      stepLevel: clip.stepLevel,
      entryPrice: entry,
      side: "LONG",
      targetPrice: entry * (1 + tp),
      stopLossPrice: entry * (1 - sl),
    };
  }
  return {
    stepLevel: clip.stepLevel,
    entryPrice: entry,
    side: "SHORT",
    targetPrice: entry * (1 - tp),
    stopLossPrice: entry * (1 + sl),
  };
}

function buildRunState(
  run: {
    d1Side: "LONG" | "SHORT";
    d1EntryPrice: string;
    maxFavorablePrice: string;
  },
  activeClips: { stepLevel: number; entryPrice: string; side: "LONG" | "SHORT" }[],
  cfg: HedgeScalpingConfig,
): HedgeScalpingRunState {
  return {
    d1Side: run.d1Side,
    d1EntryPrice: num(run.d1EntryPrice),
    maxFavorablePrice: num(run.maxFavorablePrice),
    activeD2Clips: activeClips.map((c) => d2ClipStateFromRow(c, cfg)),
  };
}

async function executeHedgeScalpingIntentsTx(
  tx: HedgeScalpingDbTx,
  ctx: {
    hedgeRun: typeof hedgeScalpingVirtualRuns.$inferSelect;
    paperRunId: string;
    intents: HedgeScalpingIntent[];
    mark: number;
    cfg: HedgeScalpingConfig;
    symbol: string;
  },
): Promise<PendingLiveSignal[]> {
  const { hedgeRun, paperRunId, intents, mark, cfg, symbol } = ctx;
  const runId = hedgeRun.runId;
  const userId = hedgeRun.userId;
  const strategyId = hedgeRun.strategyId;
  const now = new Date();
  const liveSignals: PendingLiveSignal[] = [];

  if (intents.length === 0) return liveSignals;
  const first = intents[0]!;

  if (first.type === "CLOSE_ALL") {
    const reason = first.reason;
    const clips = await tx
      .select()
      .from(hedgeScalpingVirtualClips)
      .where(
        and(
          eq(hedgeScalpingVirtualClips.runId, runId),
          eq(hedgeScalpingVirtualClips.status, "active"),
        ),
      );

    let totalNet = 0;
    const d1Qty = num(hedgeRun.d1Qty);
    const d1Entry = num(hedgeRun.d1EntryPrice);

    for (const clip of clips) {
      const q = num(clip.qty);
      const entryPx = num(clip.entryPrice);
      const gross = hedgeLegGrossPnlUsd({
        side: clip.side,
        entryPrice: entryPx,
        exitPrice: mark,
        qty: q,
      });
      const fee = hedgeVirtualRoundtripFeeUsd(entryPx, mark, q);
      const net = gross - fee;
      totalNet += net;
      await insertHsVirtualFilledOrder(tx, {
        virtualPaperRunId: paperRunId,
        userId,
        strategyId,
        symbol,
        side: hedgeCloseSide(clip.side),
        quantity: q,
        fillPrice: mark,
        correlationId: hsCorrelationD2Exit(clip.clipId),
        signalAction: "exit",
        realizedPnlUsd: net,
      });
      liveSignals.push({
        correlationId: hsCorrelationD2Exit(clip.clipId),
        strategyId,
        userId,
        symbol,
        side: hedgeCloseSide(clip.side),
        quantity: fmt(q),
        markPrice: mark,
        actionType: "exit",
        metadata: { reason },
      });
    }

    if (d1Qty > 0) {
      const grossD1 = hedgeLegGrossPnlUsd({
        side: hedgeRun.d1Side,
        entryPrice: d1Entry,
        exitPrice: mark,
        qty: d1Qty,
      });
      const feeD1 = hedgeVirtualRoundtripFeeUsd(d1Entry, mark, d1Qty);
      const netD1 = grossD1 - feeD1;
      totalNet += netD1;
      await insertHsVirtualFilledOrder(tx, {
        virtualPaperRunId: paperRunId,
        userId,
        strategyId,
        symbol,
        side: hedgeCloseSide(hedgeRun.d1Side),
        quantity: d1Qty,
        fillPrice: mark,
        correlationId: hsCorrelationD1Exit(runId),
        signalAction: "exit",
        realizedPnlUsd: netD1,
      });
      liveSignals.push({
        correlationId: hsCorrelationD1Exit(runId),
        strategyId,
        userId,
        symbol,
        side: hedgeCloseSide(hedgeRun.d1Side),
        quantity: fmt(d1Qty),
        markPrice: mark,
        actionType: "exit",
        metadata: { reason },
      });
    }

    await applyHsVirtualBalanceDelta(tx, paperRunId, totalNet);

    await tx
      .update(hedgeScalpingVirtualClips)
      .set({ status: "completed", closedAt: now })
      .where(
        and(
          eq(hedgeScalpingVirtualClips.runId, runId),
          eq(hedgeScalpingVirtualClips.status, "active"),
        ),
      );
    await tx
      .update(hedgeScalpingVirtualRuns)
      .set({ status: "completed", closedAt: now })
      .where(eq(hedgeScalpingVirtualRuns.runId, runId));

    await tx
      .update(virtualStrategyRuns)
      .set({
        status: "completed",
        openNetQty: "0",
        openAvgEntryPrice: null,
        openSymbol: null,
        virtualUsedMarginUsd: "0",
        updatedAt: now,
      })
      .where(eq(virtualStrategyRuns.id, paperRunId));

    console.log(`${LOG} CLOSE_ALL run=${runId} reason=${reason} netUsd=${totalNet.toFixed(4)}`);
    return liveSignals;
  }

  for (const intent of intents) {
    if (intent.type === "CLOSE_D2_CLIP") {
      const clip = await fetchActiveClipForStep(tx, {
        hedgeRunId: runId,
        stepLevel: intent.stepLevel,
      });
      if (!clip) continue;
      const q = num(clip.qty);
      const entryPx = num(clip.entryPrice);
      const gross = hedgeLegGrossPnlUsd({
        side: clip.side,
        entryPrice: entryPx,
        exitPrice: mark,
        qty: q,
      });
      const fee = hedgeVirtualRoundtripFeeUsd(entryPx, mark, q);
      const net = gross - fee;
      await insertHsVirtualFilledOrder(tx, {
        virtualPaperRunId: paperRunId,
        userId,
        strategyId,
        symbol,
        side: hedgeCloseSide(clip.side),
        quantity: q,
        fillPrice: mark,
        correlationId: hsCorrelationD2Exit(clip.clipId),
        signalAction: "exit",
        realizedPnlUsd: net,
      });
      liveSignals.push({
        correlationId: hsCorrelationD2Exit(clip.clipId),
        strategyId,
        userId,
        symbol,
        side: hedgeCloseSide(clip.side),
        quantity: fmt(q),
        markPrice: mark,
        actionType: "exit",
        metadata: { reason: intent.reason, step_level: intent.stepLevel },
      });
      await applyHsVirtualBalanceDelta(tx, paperRunId, net);
      await tx
        .update(hedgeScalpingVirtualClips)
        .set({ status: "completed", closedAt: now })
        .where(
          and(
            eq(hedgeScalpingVirtualClips.runId, runId),
            eq(hedgeScalpingVirtualClips.stepLevel, intent.stepLevel),
            eq(hedgeScalpingVirtualClips.status, "active"),
          ),
        );
      console.log(
        `${LOG} CLOSE_D2_CLIP run=${runId} step=${intent.stepLevel} reason=${intent.reason} netUsd=${net.toFixed(4)}`,
      );
    } else if (intent.type === "OPEN_D2_CLIP") {
      const expectedD2Side = hedgeScalpingD2Side(hedgeRun.d1Side);
      if (intent.side !== expectedD2Side) {
        console.error(
          `${LOG} reject OPEN_D2_CLIP — D2 side ${intent.side} must be opposite D1 ${hedgeRun.d1Side} (expected ${expectedD2Side}) run=${runId} step=${intent.stepLevel}`,
        );
        continue;
      }
      const d1Qty = num(hedgeRun.d1Qty);
      if (!(d1Qty > 0)) {
        console.warn(`${LOG} skip OPEN_D2_CLIP — missing d1_qty run=${runId}`);
        continue;
      }
      const stepQty = computeHedgeScalpingD2StepQty(d1Qty, cfg.delta2.stepQtyPct);
      if (!(stepQty > 0)) {
        console.warn(`${LOG} skip OPEN_D2_CLIP — zero step qty run=${runId}`);
        continue;
      }
      const [inserted] = await tx
        .insert(hedgeScalpingVirtualClips)
        .values({
          runId,
          stepLevel: intent.stepLevel,
          entryPrice: fmt(intent.expectedPrice),
          side: intent.side,
          qty: fmt(stepQty),
          status: "active",
          createdAt: now,
        })
        .returning({ clipId: hedgeScalpingVirtualClips.clipId });

      const clipId = inserted!.clipId;
      await insertHsVirtualFilledOrder(tx, {
        virtualPaperRunId: paperRunId,
        userId,
        strategyId,
        symbol,
        side: hedgeOpenSide(intent.side),
        quantity: stepQty,
        fillPrice: intent.expectedPrice,
        correlationId: hsCorrelationD2Entry(intent.stepLevel, clipId),
        signalAction: "entry",
        realizedPnlUsd: null,
      });
      liveSignals.push({
        correlationId: hsCorrelationD2Entry(intent.stepLevel, clipId),
        strategyId,
        userId,
        symbol,
        side: hedgeOpenSide(intent.side),
        quantity: fmt(stepQty),
        markPrice: intent.expectedPrice,
        actionType: "entry",
        metadata: {
          step_level: intent.stepLevel,
          expected_price: intent.expectedPrice,
        },
      });
      console.log(
        `${LOG} OPEN_D2_CLIP run=${runId} step=${intent.stepLevel} side=${intent.side} qty=${fmt(stepQty)} entry=${fmt(intent.expectedPrice)}`,
      );
    }
  }
  return liveSignals;
}

async function processOneActiveRun(params: {
  run: typeof hedgeScalpingVirtualRuns.$inferSelect;
  clips: (typeof hedgeScalpingVirtualClips.$inferSelect)[];
  settingsJson: unknown;
}): Promise<void> {
  const { run, clips, settingsJson } = params;
  const cfg = parseHedgeScalpingStrategySettings(settingsJson);
  if (!cfg) {
    console.warn(`${LOG} invalid config — marking run failed run=${run.runId} strategy=${run.strategyId}`);
    await db!
      .update(hedgeScalpingVirtualRuns)
      .set({ status: "failed", closedAt: new Date() })
      .where(eq(hedgeScalpingVirtualRuns.runId, run.runId));
    return;
  }

  const resolvedSymbol = await db!.transaction(async (tx) =>
    resolveHedgeScalpingTradingSymbol(tx, run.userId, run.strategyId, cfg),
  );
  const sym = resolvedSymbol?.trim();
  if (!sym) {
    console.warn(`${LOG} skip active run — could not resolve symbol run=${run.runId}`);
    return;
  }
  const markPx = await fetchDeltaIndiaTickerMarkPrice({ symbol: sym });
  if (markPx == null || !Number.isFinite(markPx) || !(markPx > 0)) {
    console.warn(`${LOG} skip active run — mark unavailable symbol=${sym} run=${run.runId}`);
    return;
  }
  const mark = markPx;
  const entry = num(run.d1EntryPrice);
  const prevMax = num(run.maxFavorablePrice);
  const merged = mergeMaxFavorable(run.d1Side, prevMax, mark);

  const activeClips = clips.filter((c) => c.status === "active");

  const runForEval =
    merged !== prevMax && Number.isFinite(merged)
      ? { ...run, maxFavorablePrice: fmt(merged) }
      : run;

  const state = buildRunState(
    runForEval,
    activeClips.map((c) => ({
      stepLevel: c.stepLevel,
      entryPrice: String(c.entryPrice),
      side: c.side,
    })),
    cfg,
  );

  const maxFavEval = num(runForEval.maxFavorablePrice);
  const initialD1Sl = d1HardStopPrice(run.d1Side, entry, cfg.delta1.stopLossPct);
  const { trailedStopPrice: trailedD1Sl } = d1ContinuousTrailedStopPrice(
    run.d1Side,
    entry,
    maxFavEval,
    initialD1Sl,
  );
  console.log(
    `${LOG} D1 Continuous Trail: Entry=${fmt(entry)}, MaxFav=${fmt(maxFavEval)}, InitialSL=${fmt(initialD1Sl)}, TrailedSL=${fmt(trailedD1Sl)} run=${run.runId}`,
  );

  const favPct = d1FavorableDistancePct(run.d1Side, entry, mark);
  const theoreticalStep = maxD2LadderStepInclusive(favPct, cfg.delta2.stepMovePct);
  const bands = d2LadderFavorableBandFloor(favPct, cfg.delta2.stepMovePct);
  const activeStepLevels = clips
    .filter((c) => c.status === "active")
    .map((c) => c.stepLevel)
    .sort((a, b) => a - b);
  const closedStepLevels = clips
    .filter((c) => c.status === "completed")
    .map((c) => c.stepLevel)
    .sort((a, b) => a - b);
  const openLadderSteps = state.activeD2Clips
    .map((c) => c.stepLevel)
    .sort((a, b) => a - b);
  console.log(
    `${LOG} D1 Entry: ${fmt(entry)}, Mark: ${fmt(mark)}, FavorablePct: ${favPct.toFixed(4)}%, TheoreticalStep: ${theoreticalStep} (bands=${bands}), Active/Closed Steps: active=[${activeStepLevels.join(",")}] closed=[${closedStepLevels.join(",")}] openLadderSteps=[${openLadderSteps.join(",")}] run=${run.runId}`,
  );

  const intents = evaluateHedgeScalpingState(state, mark, cfg);
  if (intents.length === 0) {
    if (merged !== prevMax && Number.isFinite(merged)) {
      await db!
        .update(hedgeScalpingVirtualRuns)
        .set({ maxFavorablePrice: fmt(merged) })
        .where(eq(hedgeScalpingVirtualRuns.runId, run.runId));
    }
    return;
  }

  console.log(
    `${LOG} evaluate run=${run.runId} mark=${fmt(mark)} d1=${run.d1Side} intents=${intents.length}`,
  );

  const liveSignals = await db!.transaction(async (tx) => {
    if (merged !== prevMax && Number.isFinite(merged)) {
      await tx
        .update(hedgeScalpingVirtualRuns)
        .set({ maxFavorablePrice: fmt(merged) })
        .where(eq(hedgeScalpingVirtualRuns.runId, run.runId));
    }
    const paperRunId = await resolveVirtualPaperRunId(tx, {
      userId: run.userId,
      strategyId: run.strategyId,
    });
    if (!paperRunId) {
      console.warn(
        `${LOG} no active virtual_strategy_run user=${run.userId} strategy=${run.strategyId} — skip intents`,
      );
      return [] as PendingLiveSignal[];
    }
    const hedgeRun = (await fetchHedgeRunRow(tx, run.runId)) ?? run;
    const symbol = await resolveHedgeScalpingTradingSymbol(tx, run.userId, run.strategyId, cfg);
    if (!symbol) {
      console.warn(
        `${LOG} skip intents — could not resolve symbol user=${run.userId} strategy=${run.strategyId}`,
      );
      return [] as PendingLiveSignal[];
    }
    return await executeHedgeScalpingIntentsTx(tx, {
      hedgeRun,
      paperRunId,
      intents,
      mark,
      cfg,
      symbol,
    });
  });
  if (liveSignals.length > 0) {
    await dispatchPendingHsLiveSignals(liveSignals);
  }
}

export type HedgeScalpingStrategyFeedFilter = {
  symbol: string;
  resolution: string;
};

function strategyMatchesFeedFilter(
  cfg: HedgeScalpingConfig,
  filter: HedgeScalpingStrategyFeedFilter | null,
): boolean {
  if (!filter) return true;
  const tf = cfg.general.timeframe.trim().toLowerCase();
  if (tf !== filter.resolution.trim().toLowerCase()) return false;
  const syms = parseAllowedSymbolsList(cfg.general.allowedSymbols);
  return syms.includes(filter.symbol.trim().toUpperCase());
}

/**
 * Updates all active hedge-scalping virtual runs (D1/D2 math, marks, intents). Safe to call once per worker tick.
 * Each run uses only `fetchDeltaIndiaTickerMarkPrice` for its resolved venue symbol (no cross-symbol mark).
 */
export async function processHedgeScalpingActiveRunsPhase(): Promise<void> {
  if (!db) {
    console.warn(`${LOG} skip active runs — database not configured`);
    return;
  }

  const activeRuns = await db
    .select()
    .from(hedgeScalpingVirtualRuns)
    .where(eq(hedgeScalpingVirtualRuns.status, "active"));

  const runIds = activeRuns.map((r) => r.runId);
  const clipsByRun = new Map<string, (typeof hedgeScalpingVirtualClips.$inferSelect)[]>();
  if (runIds.length > 0) {
    const allClips = await db
      .select()
      .from(hedgeScalpingVirtualClips)
      .where(inArray(hedgeScalpingVirtualClips.runId, runIds));
    for (const c of allClips) {
      const list = clipsByRun.get(c.runId) ?? [];
      list.push(c);
      clipsByRun.set(c.runId, list);
    }
  }

  const strategyIds = [...new Set(activeRuns.map((r) => r.strategyId))];
  const strategyRows =
    strategyIds.length > 0
      ? await db
          .select({
            id: strategies.id,
            settingsJson: strategies.settingsJson,
          })
          .from(strategies)
          .where(inArray(strategies.id, strategyIds))
      : [];
  const settingsByStrategyId = new Map(
    strategyRows.map((s) => [s.id, s.settingsJson]),
  );

  for (const run of activeRuns) {
    const clips = clipsByRun.get(run.runId) ?? [];
    const settingsJson = settingsByStrategyId.get(run.strategyId) ?? null;
    try {
      await processOneActiveRun({
        run,
        clips,
        settingsJson,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${LOG} run=${run.runId} error=${msg.slice(0, 500)}`);
    }
  }
}

/**
 * HalfTrend new-run fan-out. When `feedFilter` is set, only strategies whose `general.timeframe`
 * and `allowedSymbols` match that feed run `analyzeHedgeScalpingSignal` on `currentCandles`.
 */
export async function processHedgeScalpingNewEntriesPhase(
  currentCandles: Candle[],
  currentMarkPrice: number,
  feedFilter: HedgeScalpingStrategyFeedFilter | null,
): Promise<void> {
  if (!db) {
    console.warn(`${LOG} skip new entries — database not configured`);
    return;
  }
  if (!Number.isFinite(currentMarkPrice) || currentMarkPrice <= 0) {
    console.warn(`${LOG} skip new entries — invalid mark=${String(currentMarkPrice)}`);
    return;
  }

  const hedgeStrategies = await db
    .select({
      id: strategies.id,
      settingsJson: strategies.settingsJson,
      slug: strategies.slug,
    })
    .from(strategies)
    .where(and(isNull(strategies.deletedAt), eq(strategies.status, "active")));

  const hsStrategies = hedgeStrategies.filter((s) => isHedgeScalpingStrategySlug(s.slug));

  for (const strat of hsStrategies) {
    const cfg = parseHedgeScalpingStrategySettings(strat.settingsJson);
    if (!cfg) {
      console.warn(`${LOG} skip new entries — invalid settings strategy=${strat.id}`);
      continue;
    }
    if (!strategyMatchesFeedFilter(cfg, feedFilter)) continue;

    const paperUsers = await db
      .selectDistinct({ userId: virtualStrategyRuns.userId })
      .from(virtualStrategyRuns)
      .where(
        and(
          eq(virtualStrategyRuns.strategyId, strat.id),
          eq(virtualStrategyRuns.status, "active"),
        ),
      );

    for (const { userId } of paperUsers) {
      const [existingActive] = await db
        .select({ runId: hedgeScalpingVirtualRuns.runId })
        .from(hedgeScalpingVirtualRuns)
        .where(
          and(
            eq(hedgeScalpingVirtualRuns.userId, userId),
            eq(hedgeScalpingVirtualRuns.strategyId, strat.id),
            eq(hedgeScalpingVirtualRuns.status, "active"),
          ),
        )
        .limit(1);
      if (existingActive) continue;

      const signalAnalysis = analyzeHedgeScalpingSignal(
        currentCandles,
        cfg.general.halfTrendAmplitude,
      );
      const sig = signalAnalysis.signal;
      if (sig !== "LONG" && sig !== "SHORT") continue;

      const maxEntryDistanceFromSignalPct = cfg.general.maxEntryDistanceFromSignalPct;
      const { closedPrice, htValue } = signalAnalysis;
      if (!Number.isFinite(closedPrice) || !Number.isFinite(htValue) || Math.abs(htValue) < 1e-12) {
        console.warn(
          `${LOG} NEW_RUN skip — invalid close/ht for distance guard user=${userId} strategy=${strat.id} close=${String(closedPrice)} ht=${String(htValue)}`,
        );
        continue;
      }
      const distancePct = (Math.abs(closedPrice - htValue) / htValue) * 100;
      if (distancePct > maxEntryDistanceFromSignalPct) {
        console.log(
          `${LOG} Skipped NEW_RUN: Entry distance (${distancePct}%) exceeds max allowed (${maxEntryDistanceFromSignalPct}%) from HalfTrend baseline.`,
        );
        continue;
      }

      const d1Side = sig;
      const [lastRun] = await db
        .select({
          d1Side: hedgeScalpingVirtualRuns.d1Side,
          runId: hedgeScalpingVirtualRuns.runId,
          createdAt: hedgeScalpingVirtualRuns.createdAt,
        })
        .from(hedgeScalpingVirtualRuns)
        .where(
          and(
            eq(hedgeScalpingVirtualRuns.userId, userId),
            eq(hedgeScalpingVirtualRuns.strategyId, strat.id),
          ),
        )
        .orderBy(desc(hedgeScalpingVirtualRuns.createdAt))
        .limit(1);
      if (lastRun && lastRun.d1Side === d1Side) {
        console.log(
          `${LOG} NEW_RUN skip — same trend as last run user=${userId} strategy=${strat.id} lastRun=${lastRun.runId} d1=${d1Side}`,
        );
        continue;
      }
      const d2Side = hedgeScalpingD2Side(d1Side);
      if (hedgeOpenSide(d1Side) === hedgeOpenSide(d2Side)) {
        console.error(
          `${LOG} NEW_RUN reject — D1/D2 would use the same order side (hedge broken) user=${userId} strategy=${strat.id}`,
        );
        continue;
      }
      const now = new Date();

      try {
        const liveSignals = await db.transaction(async (tx) => {
          const paperRunId = await resolveVirtualPaperRunId(tx, {
            userId,
            strategyId: strat.id,
          });
          if (!paperRunId) {
            console.warn(
              `${LOG} NEW_RUN skip — no active virtual_strategy_run user=${userId} strategy=${strat.id}`,
            );
            return [] as PendingLiveSignal[];
          }
          const symbol = await resolveHedgeScalpingTradingSymbol(tx, userId, strat.id, cfg);
          if (!symbol) {
            console.warn(
              `${LOG} NEW_RUN skip — no allowed symbols strategy=${strat.id} user=${userId}`,
            );
            return [] as PendingLiveSignal[];
          }
          const markUsd = await hedgeScalpingMarkUsdOrFallback(symbol, currentMarkPrice);
          const entryStr = fmt(markUsd);
          const maxFavStr = entryStr;
          const paper = await loadVirtualPaperRunForSizing(tx, paperRunId);
          if (!paper) return [] as PendingLiveSignal[];
          const balanceUsd = hedgeSizingBalanceUsd(paper);
          const d1QtyNum = computeHedgeScalpingD1Qty({
            balanceUsd,
            markPrice: markUsd,
            baseQtyPct: cfg.delta1.baseQtyPct,
          });
          const d2StepQty = computeHedgeScalpingD2StepQty(d1QtyNum, cfg.delta2.stepQtyPct);
          if (!(d1QtyNum > 0) || !(d2StepQty > 0)) {
            console.warn(
              `${LOG} NEW_RUN skip — zero qty user=${userId} strategy=${strat.id} balance=${balanceUsd} markUsd=${markUsd} workerMark=${currentMarkPrice}`,
            );
            return [] as PendingLiveSignal[];
          }

          const [inserted] = await tx
            .insert(hedgeScalpingVirtualRuns)
            .values({
              userId,
              strategyId: strat.id,
              status: "active",
              d1Side,
              d1EntryPrice: entryStr,
              maxFavorablePrice: maxFavStr,
              d1Qty: fmt(d1QtyNum),
              createdAt: now,
            })
            .returning({ runId: hedgeScalpingVirtualRuns.runId });

          const hedgeRunId = inserted!.runId;

          const [clipIns] = await tx
            .insert(hedgeScalpingVirtualClips)
            .values({
              runId: hedgeRunId,
              stepLevel: 1,
              entryPrice: entryStr,
              side: d2Side,
              qty: fmt(d2StepQty),
              status: "active",
              createdAt: now,
            })
            .returning({ clipId: hedgeScalpingVirtualClips.clipId });

          const clipId = clipIns!.clipId;

          await insertHsVirtualFilledOrder(tx, {
            virtualPaperRunId: paperRunId,
            userId,
            strategyId: strat.id,
            symbol,
            side: hedgeOpenSide(d1Side),
            quantity: d1QtyNum,
            fillPrice: markUsd,
            correlationId: hsCorrelationD1Entry(hedgeRunId),
            signalAction: "entry",
            realizedPnlUsd: null,
          });

          await insertHsVirtualFilledOrder(tx, {
            virtualPaperRunId: paperRunId,
            userId,
            strategyId: strat.id,
            symbol,
            side: hedgeOpenSide(d2Side),
            quantity: d2StepQty,
            fillPrice: markUsd,
            correlationId: hsCorrelationD2Entry(1, clipId),
            signalAction: "entry",
            realizedPnlUsd: null,
          });

          console.log(
            `${LOG} NEW_RUN user=${userId} strategy=${strat.id} run=${hedgeRunId} d1=${d1Side} d1Qty=${fmt(d1QtyNum)} d2_qty=${fmt(d2StepQty)} entry=${entryStr}`,
          );
          return [
            {
              correlationId: hsCorrelationD1Entry(hedgeRunId),
              strategyId: strat.id,
              userId,
              symbol,
              side: hedgeOpenSide(d1Side),
              quantity: fmt(d1QtyNum),
              markPrice: markUsd,
              actionType: "entry" as const,
              metadata: { leg: "d1_new_run" },
            },
            {
              correlationId: hsCorrelationD2Entry(1, clipId),
              strategyId: strat.id,
              userId,
              symbol,
              side: hedgeOpenSide(d2Side),
              quantity: fmt(d2StepQty),
              markPrice: markUsd,
              actionType: "entry" as const,
              metadata: { leg: "d2_step_1_new_run", step_level: 1 },
            },
          ];
        });
        if (liveSignals.length > 0) {
          await dispatchPendingHsLiveSignals(liveSignals);
        }
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err?.code === "23505") {
          console.log(
            `${LOG} skip duplicate active run user=${userId} strategy=${strat.id} (race)`,
          );
          continue;
        }
        const msg = err?.message ?? String(e);
        console.error(
          `${LOG} NEW_RUN failed user=${userId} strategy=${strat.id} err=${msg.slice(0, 400)}`,
        );
      }
    }
  }
}

/**
 * Cron/worker entry: active runs + optional feed-scoped new entries.
 *
 * @param feedFilter When set, NEW_RUN logic runs only for strategies on that symbol+timeframe;
 *   active runs always process. When null, legacy single-feed behavior (all strategies see the same candles).
 */
export async function pollHedgeScalpingVirtualTrades(
  currentCandles: Candle[],
  currentMarkPrice: number,
  feedFilter: HedgeScalpingStrategyFeedFilter | null = null,
): Promise<void> {
  await processHedgeScalpingActiveRunsPhase();
  await processHedgeScalpingNewEntriesPhase(currentCandles, currentMarkPrice, feedFilter);
}
