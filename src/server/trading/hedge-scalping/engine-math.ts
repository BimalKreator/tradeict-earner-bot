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
 * Price at which breakeven arming triggers: `breakevenTriggerPct` percent of the **distance**
 * from entry toward the take-profit price (not % of entry notional).
 */
export function d1BreakevenTriggerPrice(
  d1Side: "LONG" | "SHORT",
  entry: number,
  targetPrice: number,
  breakevenTriggerPct: number,
): number {
  const f = breakevenTriggerPct / 100;
  return d1Side === "LONG"
    ? entry + (targetPrice - entry) * f
    : entry - (entry - targetPrice) * f;
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

function breakevenArmed(
  d1Side: "LONG" | "SHORT",
  maxFavorablePrice: number,
  triggerPrice: number,
  breakevenTriggerPct: number,
): boolean {
  if (!(breakevenTriggerPct > 0)) return false;
  if (!Number.isFinite(maxFavorablePrice) || !Number.isFinite(triggerPrice)) return false;
  const eps = priceEps(triggerPrice);
  return d1Side === "LONG"
    ? maxFavorablePrice >= triggerPrice - eps
    : maxFavorablePrice <= triggerPrice + eps;
}

/**
 * True once favorable excursion (tracked in `maxFavorablePrice`) has reached the breakeven
 * trigger — same rule as `evaluateHedgeScalpingState` / poller D1 exit logic.
 */
export function hedgeScalpingD1BreakevenArmed(
  d1Side: "LONG" | "SHORT",
  entry: number,
  maxFavorablePrice: number,
  d1: { targetProfitPct: number; breakevenTriggerPct: number },
): boolean {
  if (!(entry > 0) || !Number.isFinite(maxFavorablePrice)) return false;
  const targetPrice = d1TargetPrice(d1Side, entry, d1.targetProfitPct);
  const beTriggerPrice = d1BreakevenTriggerPrice(
    d1Side,
    entry,
    targetPrice,
    d1.breakevenTriggerPct,
  );
  return breakevenArmed(
    d1Side,
    maxFavorablePrice,
    beTriggerPrice,
    d1.breakevenTriggerPct,
  );
}

function d1CloseIntent(
  d1Side: "LONG" | "SHORT",
  entry: number,
  mark: number,
  targetPrice: number,
  hardStopPrice: number,
  beArmed: boolean,
): HedgeScalpingIntent | null {
  const eps = priceEps(entry);

  if (d1Side === "LONG") {
    if (mark >= targetPrice - eps) {
      return { type: "CLOSE_ALL", reason: "D1_TARGET_HIT" };
    }
    const effectiveStop = beArmed ? entry : hardStopPrice;
    if (mark <= effectiveStop + eps) {
      if (beArmed) {
        return { type: "CLOSE_ALL", reason: "D1_BREAKEVEN_HIT" };
      }
      return { type: "CLOSE_ALL", reason: "D1_SL_HIT" };
    }
  } else {
    if (mark <= targetPrice + eps) {
      return { type: "CLOSE_ALL", reason: "D1_TARGET_HIT" };
    }
    const effectiveStop = beArmed ? entry : hardStopPrice;
    if (mark >= effectiveStop - eps) {
      if (beArmed) {
        return { type: "CLOSE_ALL", reason: "D1_BREAKEVEN_HIT" };
      }
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

function hasOccupiedD2Step(occupied: readonly number[], stepLevel: number): boolean {
  return occupied.includes(stepLevel);
}

/**
 * Pure state evaluation: D1 target / SL / breakeven, D2 per-clip TP/SL, and D2 ladder
 * (zigzag: open missing steps 1..max inclusive, where max = 1 + floor(favorable/stepMove),
 * accounting for the seed clip at step 1; never re-open an occupied step level).
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
  const hardStopPrice = d1HardStopPrice(state.d1Side, entry, d1.stopLossPct);
  const beTriggerPrice = d1BreakevenTriggerPrice(
    state.d1Side,
    entry,
    targetPrice,
    d1.breakevenTriggerPct,
  );
  const beArmed = breakevenArmed(
    state.d1Side,
    state.maxFavorablePrice,
    beTriggerPrice,
    d1.breakevenTriggerPct,
  );

  const d1Exit = d1CloseIntent(
    state.d1Side,
    entry,
    mark,
    targetPrice,
    hardStopPrice,
    beArmed,
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
  const d2Side = hedgeScalpingD2Side(state.d1Side);

  for (let step = 1; step <= maxStep; step += 1) {
    if (!hasOccupiedD2Step(state.occupiedD2StepLevels, step)) {
      out.push({
        type: "OPEN_D2_CLIP",
        stepLevel: step,
        expectedPrice: mark,
        side: d2Side,
      });
    }
  }

  return out;
}
