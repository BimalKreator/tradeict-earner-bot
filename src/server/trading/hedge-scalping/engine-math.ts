import type { HedgeScalpingConfig } from "@/lib/hedge-scalping-config";

import type {
  D2ClipState,
  HedgeScalpingIntent,
  HedgeScalpingRunState,
} from "./types";

const PRICE_EPS_RATIO = 1e-10;

function priceEps(entry: number): number {
  return Math.max(1e-12, Math.abs(entry) * PRICE_EPS_RATIO);
}

/** D2 hedge leg is always opposite D1. */
export function hedgeScalpingD2Side(d1Side: "LONG" | "SHORT"): "LONG" | "SHORT" {
  return d1Side === "LONG" ? "SHORT" : "LONG";
}

/** Absolute D1 take-profit price from entry and target %. */
export function d1TargetPrice(
  d1Side: "LONG" | "SHORT",
  entry: number,
  targetProfitPct: number,
): number {
  const p = targetProfitPct / 100;
  return d1Side === "LONG" ? entry * (1 + p) : entry * (1 - p);
}

/** Absolute D1 initial hard stop price from entry and stop %. */
export function d1HardStopPrice(
  d1Side: "LONG" | "SHORT",
  entry: number,
  stopLossPct: number,
): number {
  const p = stopLossPct / 100;
  return d1Side === "LONG" ? entry * (1 - p) : entry * (1 + p);
}

/**
 * Favorable point excursion vs entry using the `maxFavorablePrice` watermark (never shrinks).
 * - LONG: max(0, maxFavorablePrice - entry)
 * - SHORT: max(0, entry - maxFavorablePrice)
 */
export function d1FavorablePointExcursion(
  d1Side: "LONG" | "SHORT",
  entry: number,
  maxFavorablePrice: number,
): number {
  if (!(entry > 0) || !Number.isFinite(maxFavorablePrice)) return 0;
  if (d1Side === "LONG") {
    return Math.max(0, maxFavorablePrice - entry);
  }
  return Math.max(0, entry - maxFavorablePrice);
}

/**
 * D1 stop after continuous 1:1 trail: initial SL from entry ± stopLoss%, then move one point
 * for each point of favorable excursion (same watermark as ladder / `maxFavorablePrice`).
 */
export function d1ContinuousTrailedStopPrice(
  d1Side: "LONG" | "SHORT",
  entry: number,
  maxFavorablePrice: number,
  initialStopPrice: number,
): { favorablePoints: number; trailedStopPrice: number } {
  const favorablePoints = d1FavorablePointExcursion(d1Side, entry, maxFavorablePrice);
  const trailedStopPrice =
    d1Side === "LONG"
      ? initialStopPrice + favorablePoints
      : initialStopPrice - favorablePoints;
  return { favorablePoints, trailedStopPrice };
}

/**
 * Non-negative favorable excursion in percent from entry to current mark.
 * - LONG: only when mark >= entry.
 * - SHORT: only when mark <= entry.
 */
export function d1FavorableDistancePct(
  d1Side: "LONG" | "SHORT",
  entry: number,
  mark: number,
): number {
  if (!(entry > 0) || !Number.isFinite(mark)) return 0;
  if (d1Side === "LONG") {
    if (mark < entry) return 0;
    return ((mark - entry) / entry) * 100;
  }
  if (mark > entry) return 0;
  return ((entry - mark) / entry) * 100;
}

/**
 * Count of full `stepMovePct` favorable bands beyond D1 entry (0 when flat or unfavorable).
 * Seed D2 step 1 is opened at run start; each additional band adds one more ladder rung.
 */
export function d2LadderFavorableBandFloor(
  favorableDistancePct: number,
  stepMovePct: number,
): number {
  if (!(stepMovePct > 0) || !(favorableDistancePct > 0)) return 0;
  return Math.floor(favorableDistancePct / stepMovePct + 1e-12);
}

/**
 * Highest 1-based D2 ladder step that should exist: step 1 at D1 entry, then one step per
 * full `stepMovePct` of favorable excursion (mark vs D1 entry).
 */
export function maxD2LadderStepInclusive(
  favorableDistancePct: number,
  stepMovePct: number,
): number {
  if (!(stepMovePct > 0)) return 1;
  return 1 + d2LadderFavorableBandFloor(favorableDistancePct, stepMovePct);
}

function d1CloseIntent(
  d1Side: "LONG" | "SHORT",
  entry: number,
  mark: number,
  targetPrice: number,
  trailedStopPrice: number,
): HedgeScalpingIntent | null {
  const eps = priceEps(entry);

  if (d1Side === "LONG") {
    if (mark >= targetPrice - eps) {
      return { type: "CLOSE_ALL", reason: "D1_TARGET_HIT" };
    }
    if (mark <= trailedStopPrice + eps) {
      return { type: "CLOSE_ALL", reason: "D1_SL_HIT" };
    }
  } else {
    if (mark <= targetPrice + eps) {
      return { type: "CLOSE_ALL", reason: "D1_TARGET_HIT" };
    }
    if (mark >= trailedStopPrice - eps) {
      return { type: "CLOSE_ALL", reason: "D1_SL_HIT" };
    }
  }
  return null;
}

function d2ClipExitIntent(
  clip: D2ClipState,
  mark: number,
): HedgeScalpingIntent | null {
  const eps = priceEps(clip.entryPrice);
  if (clip.side === "LONG") {
    if (mark >= clip.targetPrice - eps) {
      return { type: "CLOSE_D2_CLIP", stepLevel: clip.stepLevel, reason: "D2_TARGET_HIT" };
    }
    if (mark <= clip.stopLossPrice + eps) {
      return { type: "CLOSE_D2_CLIP", stepLevel: clip.stepLevel, reason: "D2_SL_HIT" };
    }
  } else {
    if (mark <= clip.targetPrice + eps) {
      return { type: "CLOSE_D2_CLIP", stepLevel: clip.stepLevel, reason: "D2_TARGET_HIT" };
    }
    if (mark >= clip.stopLossPrice - eps) {
      return { type: "CLOSE_D2_CLIP", stepLevel: clip.stepLevel, reason: "D2_SL_HIT" };
    }
  }
  return null;
}

function hasActiveD2ClipAtStep(clips: D2ClipState[], stepLevel: number): boolean {
  return clips.some((c) => c.stepLevel === stepLevel);
}

/**
 * Pure state evaluation: D1 target / continuous 1:1 trailed SL, D2 per-clip TP/SL, and D2 ladder
 * (zigzag: open step N when maxStep ≥ N and there is no **active** clip at N — completed clips
 * do not block re-entry; each new clip uses current mark as entry for TP/SL via executor).
 *
 * Precedence: if D1 must flat, returns only `[{ type: 'CLOSE_ALL', ... }]`.
 */
export function evaluateHedgeScalpingState(
  state: HedgeScalpingRunState,
  currentMarkPrice: number,
  config: HedgeScalpingConfig,
): HedgeScalpingIntent[] {
  const mark = currentMarkPrice;
  const entry = state.d1EntryPrice;
  if (!(entry > 0) || !Number.isFinite(mark)) {
    return [];
  }

  const d1 = config.delta1;
  const d2 = config.delta2;

  const targetPrice = d1TargetPrice(state.d1Side, entry, d1.targetProfitPct);
  const initialSl = d1HardStopPrice(state.d1Side, entry, d1.stopLossPct);
  const { trailedStopPrice } = d1ContinuousTrailedStopPrice(
    state.d1Side,
    entry,
    state.maxFavorablePrice,
    initialSl,
  );

  const d1Exit = d1CloseIntent(
    state.d1Side,
    entry,
    mark,
    targetPrice,
    trailedStopPrice,
  );
  if (d1Exit) {
    return [d1Exit];
  }

  const out: HedgeScalpingIntent[] = [];

  for (const clip of state.activeD2Clips) {
    const ex = d2ClipExitIntent(clip, mark);
    if (ex) out.push(ex);
  }

  const favorablePct = d1FavorableDistancePct(state.d1Side, entry, mark);
  const maxStep = maxD2LadderStepInclusive(favorablePct, d2.stepMovePct);
  /** Hedge invariant: ladder clips always take the leg opposite D1 (never copy `state.d1Side`). */
  const d2Side = hedgeScalpingD2Side(state.d1Side);

  for (let step = 1; step <= maxStep; step += 1) {
    // Sole blocker for opening step N on this tick: step N is already active.
    // Closed/history clips are intentionally ignored so a closed step can re-enter.
    if (hasActiveD2ClipAtStep(state.activeD2Clips, step)) continue;
    // Sequential gate: never open step N if step N-1 is not currently active.
    if (step > 1 && !hasActiveD2ClipAtStep(state.activeD2Clips, step - 1)) break;
    // Burst guard: at most one OPEN_D2_CLIP intent per tick.
    out.push({
      type: "OPEN_D2_CLIP",
      stepLevel: step,
      expectedPrice: mark,
      side: d2Side,
    });
    break;
  }

  return out;
}
