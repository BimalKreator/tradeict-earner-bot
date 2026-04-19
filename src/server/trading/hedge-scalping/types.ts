/**
 * Hedge Scalping (Dual Account) — signal layer types only.
 *
 * `previousTrend` / `currentTrend` use **`calculateHalfTrend` semantics** (Pine):
 * **0 = uptrend**, **1 = downtrend**. Do not confuse with prose that labels 0 as “down”;
 * the detector compares raw `trend` values from the indicator only.
 */

export type HedgeScalpingSignal = "LONG" | "SHORT" | "WAIT";

/** Snapshot after evaluating the last two closed bars (HalfTrend convention). */
export type HedgeScalpingState = {
  previousTrend: 0 | 1;
  currentTrend: 0 | 1;
};

export type HedgeScalpingD1CloseReason =
  | "D1_TARGET_HIT"
  | "D1_SL_HIT"
  | "D1_BREAKEVEN_HIT";

export type HedgeScalpingD2CloseReason = "D2_TARGET_HIT" | "D2_SL_HIT";

export type HedgeScalpingIntent =
  | { type: "CLOSE_ALL"; reason: HedgeScalpingD1CloseReason }
  | {
      type: "OPEN_D2_CLIP";
      stepLevel: number;
      expectedPrice: number;
      side: "LONG" | "SHORT";
    }
  | { type: "CLOSE_D2_CLIP"; stepLevel: number; reason: HedgeScalpingD2CloseReason };

export type D2ClipState = {
  stepLevel: number;
  entryPrice: number;
  side: "LONG" | "SHORT";
  targetPrice: number;
  stopLossPrice: number;
};

/**
 * Runtime snapshot for the pure math evaluator (no DB).
 *
 * `maxFavorablePrice`:
 * - **D1 LONG:** highest mark seen (favorable = up).
 * - **D1 SHORT:** lowest mark seen (favorable = down); still stored in this field as the
 *   extreme price in the profitable direction for the short.
 */
export type HedgeScalpingRunState = {
  d1Side: "LONG" | "SHORT";
  d1EntryPrice: number;
  maxFavorablePrice: number;
  activeD2Clips: D2ClipState[];
};
