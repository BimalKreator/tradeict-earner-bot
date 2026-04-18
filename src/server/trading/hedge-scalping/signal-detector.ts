import {
  calculateHalfTrend,
  type Candle,
} from "@/server/trading/ta-engine/indicators/halftrend";

import type { HedgeScalpingSignal, HedgeScalpingState } from "./types";

const HS_LOG_PREFIX = "[HS-SIGNAL]";
const DEFAULT_CHANNEL_DEVIATION = 2;

/**
 * If the series has at least three bars, the final bar is treated as the live / forming candle
 * and is excluded from signal evaluation. If there are exactly two bars, both are treated as closed.
 */
function closedBarsForSignal(candles: Candle[]): Candle[] {
  if (candles.length >= 3) {
    return candles.slice(0, -1);
  }
  return candles.slice();
}

function logHedgeScalpingSignal(params: {
  price: number;
  htValue: number;
  state: HedgeScalpingState;
  signal: HedgeScalpingSignal;
}): void {
  const { price, htValue, state, signal } = params;
  const px = Number.isFinite(price) ? price.toFixed(2) : String(price);
  const ht = Number.isFinite(htValue) ? htValue.toFixed(4) : String(htValue);
  console.log(
    `${HS_LOG_PREFIX} price=${px} ht=${ht} prevTrend=${state.previousTrend} newTrend=${state.currentTrend} signal=${signal}`,
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
export function detectHedgeScalpingSignal(
  candles: Candle[],
  amplitude: number,
): HedgeScalpingSignal {
  const closed = closedBarsForSignal(candles);

  if (closed.length < 2) {
    const noopState: HedgeScalpingState = { previousTrend: 0, currentTrend: 0 };
    logHedgeScalpingSignal({
      price: closed.at(-1)?.close ?? NaN,
      htValue: NaN,
      state: noopState,
      signal: "WAIT",
    });
    return "WAIT";
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

  const lastClose = closed[closed.length - 1]!.close;
  const price = lastClose;
  const htValue = latestHt.htValue;

  let signal: HedgeScalpingSignal = "WAIT";
  if (previousTrend === 1 && currentTrend === 0) {
    signal = "LONG";
  } else if (previousTrend === 0 && currentTrend === 1) {
    signal = "SHORT";
  }

  logHedgeScalpingSignal({ price, htValue, state, signal });
  return signal;
}
