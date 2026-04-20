import {
  calculateHalfTrend,
  type Candle,
} from "@/server/trading/ta-engine/indicators/halftrend";

import type { HedgeScalpingSignal, HedgeScalpingState } from "./types";

export type HedgeScalpingSignalAnalysis = {
  signal: HedgeScalpingSignal;
  /** Last closed candle close (signal bar), used as conceptual entry vs HalfTrend baseline. */
  closedPrice: number;
  /** HalfTrend line value on the same closed bar set as `signal`. */
  htValue: number;
};

const HS_LOG_PREFIX = "[HS-SIGNAL]";
const DEFAULT_CHANNEL_DEVIATION = 2;

/**
 * Strict "once per bar close": always treat the final bar as live/forming and exclude it from
 * signal math. This keeps `prevTrend/newTrend` stable while live price wiggles inside a bucket.
 */
function closedBarsForSignal(candles: Candle[]): Candle[] {
  if (candles.length >= 2) {
    return candles.slice(0, -1);
  }
  return candles.slice();
}

function logHedgeScalpingSignal(params: {
  livePrice: number;
  closedPrice: number;
  htValue: number;
  state: HedgeScalpingState;
  signal: HedgeScalpingSignal;
  closedBars: number;
}): void {
  const { livePrice, closedPrice, htValue, state, signal, closedBars } = params;
  const live = Number.isFinite(livePrice) ? livePrice.toFixed(2) : String(livePrice);
  const closed = Number.isFinite(closedPrice) ? closedPrice.toFixed(2) : String(closedPrice);
  const ht = Number.isFinite(htValue) ? htValue.toFixed(4) : String(htValue);
  console.log(
    `${HS_LOG_PREFIX} mode=bar_close_only livePrice=${live} closedPrice=${closed} ht=${ht} prevTrend=${state.previousTrend} newTrend=${state.currentTrend} closedBars=${closedBars} signal=${signal}`,
  );
}

/**
 * HalfTrend-only entry signal on the **last two closed** candles (forming bar dropped when present).
 *
 * Convention (matches `calculateHalfTrend`): `0` = uptrend, `1` = downtrend.
 * - **LONG:** flip **1 → 0** (downtrend to uptrend).
 * - **SHORT:** flip **0 → 1** (uptrend to downtrend).
 * - **WAIT:** no flip between those two closes.
 */
export function analyzeHedgeScalpingSignal(
  candles: Candle[],
  amplitude: number,
): HedgeScalpingSignalAnalysis {
  const closed = closedBarsForSignal(candles);

  if (closed.length < 2) {
    const noopState: HedgeScalpingState = { previousTrend: 0, currentTrend: 0 };
    const livePx = candles.at(-1)?.close ?? NaN;
    logHedgeScalpingSignal({
      livePrice: livePx,
      closedPrice: closed.at(-1)?.close ?? NaN,
      htValue: NaN,
      state: noopState,
      closedBars: closed.length,
      signal: "WAIT",
    });
    return { signal: "WAIT", closedPrice: closed.at(-1)?.close ?? NaN, htValue: NaN };
  }

  const priorClosed = closed.slice(0, -1);
  const latestHt = calculateHalfTrend(
    closed,
    amplitude,
    DEFAULT_CHANNEL_DEVIATION,
  );
  const previousHt = calculateHalfTrend(
    priorClosed,
    amplitude,
    DEFAULT_CHANNEL_DEVIATION,
  );

  const currentTrend = latestHt.trend;
  const previousTrend = previousHt.trend;
  const state: HedgeScalpingState = { previousTrend, currentTrend };

  const closedPrice = closed[closed.length - 1]!.close;
  const livePrice = candles[candles.length - 1]!.close;
  const htValue = latestHt.htValue;

  let signal: HedgeScalpingSignal = "WAIT";
  if (previousTrend === 1 && currentTrend === 0) {
    signal = "LONG";
  } else if (previousTrend === 0 && currentTrend === 1) {
    signal = "SHORT";
  }

  logHedgeScalpingSignal({
    livePrice,
    closedPrice,
    htValue,
    state,
    closedBars: closed.length,
    signal,
  });
  return { signal, closedPrice, htValue };
}

export function detectHedgeScalpingSignal(
  candles: Candle[],
  amplitude: number,
): HedgeScalpingSignal {
  return analyzeHedgeScalpingSignal(candles, amplitude).signal;
}
