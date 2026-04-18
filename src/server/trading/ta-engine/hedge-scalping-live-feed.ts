import {
  fetchDeltaExchangeCandles,
  normalizeDeltaCandlesSymbol,
  resolutionToSeconds,
  type OhlcvCandle,
} from "./rsi-scalper";

type FeedKey = string;
const MIN_SEED_BARS = 400;

type FeedState = {
  key: FeedKey;
  baseUrl: string;
  symbol: string;
  resolution: string;
  resSec: number;
  lookbackSec: number;
  candles: OhlcvCandle[];
  lastPrice: number | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  polling: boolean;
  subscribers: Set<() => void>;
  seeded: boolean;
  candleMeta: Map<number, { openTsMs: number; closeTsMs: number }>;
};

const feeds = new Map<FeedKey, FeedState>();

function feedKey(symbol: string, resolution: string): FeedKey {
  return `${symbol.trim().toUpperCase()}::${resolution.trim().toLowerCase()}`;
}

/** Add meta rows for any candle times not yet tracked (safe to call after every refresh). */
function upsertCandleMeta(state: FeedState): void {
  for (const candle of state.candles) {
    if (state.candleMeta.has(candle.time)) continue;
    const bucketStartMs = candle.time * 1000;
    state.candleMeta.set(candle.time, {
      openTsMs: bucketStartMs,
      closeTsMs: bucketStartMs + state.resSec * 1000 - 1,
    });
  }
}

function pruneCandleMeta(state: FeedState): void {
  if (state.candles.length === 0 || state.candleMeta.size === 0) return;
  const oldest = state.candles[0]!.time;
  for (const time of state.candleMeta.keys()) {
    if (time < oldest) state.candleMeta.delete(time);
  }
}

async function seedFromRest(state: FeedState, baseUrl: string, lookbackSec: number): Promise<void> {
  if (state.seeded) return;
  const seedLookbackSec = Math.max(lookbackSec, state.resSec * MIN_SEED_BARS);
  const candles = await fetchDeltaExchangeCandles({
    baseUrl,
    symbol: state.symbol,
    resolution: state.resolution,
    lookbackSec: seedLookbackSec,
  });
  if (candles.length > 0) {
    state.candles = candles;
    upsertCandleMeta(state);
    const tail = state.candles[state.candles.length - 1]!;
    state.lastPrice = tail.close;
    const nowSec = Math.floor(Date.now() / 1000);
    state.candles = applyTimeBasedCandleRollforward({
      candles: state.candles,
      resSec: state.resSec,
      tickClose: tail.close,
      nowSec,
    });
    const t2 = state.candles[state.candles.length - 1];
    if (t2 && Number.isFinite(t2.close)) state.lastPrice = t2.close;
  }
  state.seeded = true;
}

function notify(state: FeedState): void {
  for (const fn of state.subscribers) fn();
}

/** Union by bar open time (`c.time`); API row wins on collision so OHLC stays venue-accurate. */
function mergeCandlesByTimePreferApi(
  existing: OhlcvCandle[],
  fromApi: OhlcvCandle[],
): OhlcvCandle[] {
  const byTime = new Map<number, OhlcvCandle>();
  for (const c of existing) {
    byTime.set(c.time, c);
  }
  for (const c of fromApi) {
    byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Delta REST sometimes keeps updating the trailing bar in place without advancing `time` for minutes.
 * When wall clock has passed the end of the last bar's bucket, append the next bucket(s) so the
 * forming bar is current and `slice(0, -1)` sees a fresh last closed bar.
 */
function applyTimeBasedCandleRollforward(params: {
  candles: OhlcvCandle[];
  resSec: number;
  tickClose: number;
  nowSec: number;
}): OhlcvCandle[] {
  const { resSec, nowSec } = params;
  let tickClose = params.tickClose;
  const out = [...params.candles];
  if (out.length === 0 || !(resSec > 0)) return out;
  if (!Number.isFinite(tickClose) || !(tickClose > 0)) {
    tickClose = out[out.length - 1]!.close;
  }

  const maxSyntheticBars = 500;
  let added = 0;
  while (added < maxSyntheticBars) {
    const last = out[out.length - 1]!;
    if (nowSec < last.time + resSec) break;
    const nextT = last.time + resSec;
    const px = Number.isFinite(tickClose) && tickClose > 0 ? tickClose : last.close;
    out.push({
      time: nextT,
      open: last.close,
      high: Math.max(last.close, px),
      low: Math.min(last.close, px),
      close: px,
      volume: 0,
    });
    added += 1;
    console.log(
      `[HS-FEED] Rolled over to new candle for minute: ${new Date(nextT * 1000).toISOString()} (bucket=${nextT} res=${resSec}s)`,
    );
  }
  return out;
}

async function refreshFromDelta(state: FeedState): Promise<void> {
  if (state.polling) return;
  state.polling = true;
  try {
    const fromApi = await fetchDeltaExchangeCandles({
      baseUrl: state.baseUrl,
      symbol: state.symbol,
      resolution: state.resolution,
      lookbackSec: Math.max(state.lookbackSec, state.resSec * MIN_SEED_BARS),
    });
    if (fromApi.length > 0) {
      const merged = mergeCandlesByTimePreferApi(state.candles, fromApi);
      const apiLast = fromApi[fromApi.length - 1]!;
      let tickClose = apiLast.close;
      if (!Number.isFinite(tickClose) || !(tickClose > 0)) {
        tickClose =
          state.lastPrice ??
          merged[merged.length - 1]?.close ??
          0;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const rolled = applyTimeBasedCandleRollforward({
        candles: merged,
        resSec: state.resSec,
        tickClose,
        nowSec,
      });
      state.candles = rolled.slice(-2500);
      const tail = state.candles[state.candles.length - 1];
      if (tail && Number.isFinite(tail.close)) {
        state.lastPrice = tail.close;
      }
      upsertCandleMeta(state);
      pruneCandleMeta(state);
      notify(state);
    } else if (state.candles.length > 0) {
      const tickClose =
        state.lastPrice ?? state.candles[state.candles.length - 1]?.close ?? 0;
      const prevLen = state.candles.length;
      const rolled = applyTimeBasedCandleRollforward({
        candles: state.candles,
        resSec: state.resSec,
        tickClose,
        nowSec: Math.floor(Date.now() / 1000),
      });
      if (rolled.length !== prevLen) {
        state.candles = rolled.slice(-2500);
        const tail = state.candles[state.candles.length - 1];
        if (tail && Number.isFinite(tail.close)) state.lastPrice = tail.close;
        upsertCandleMeta(state);
        pruneCandleMeta(state);
        notify(state);
      }
    }
  } catch {
    /* keep previous snapshot */
  } finally {
    state.polling = false;
  }
}

function connect(state: FeedState): void {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    void refreshFromDelta(state);
  }, 1000);
  void refreshFromDelta(state);
}

export async function ensureHedgeScalpingLiveFeed(params: {
  symbol: string;
  resolution: string;
  baseUrl: string;
  lookbackSec: number;
}): Promise<void> {
  const key = feedKey(params.symbol, params.resolution);
  let state = feeds.get(key);
  if (!state) {
    state = {
      key,
      baseUrl: params.baseUrl,
      symbol: normalizeDeltaCandlesSymbol(params.baseUrl, params.symbol),
      resolution: params.resolution,
      resSec: Math.max(60, resolutionToSeconds(params.resolution)),
      lookbackSec: params.lookbackSec,
      candles: [],
      lastPrice: null,
      pollTimer: null,
      polling: false,
      subscribers: new Set(),
      seeded: false,
      candleMeta: new Map(),
    };
    feeds.set(key, state);
  }
  state.baseUrl = params.baseUrl;
  state.lookbackSec = params.lookbackSec;
  await seedFromRest(state, params.baseUrl, params.lookbackSec);
  connect(state);
}

export function getHedgeScalpingLiveSnapshot(params: {
  symbol: string;
  resolution: string;
}): { candles: OhlcvCandle[]; lastPrice: number | null } | null {
  const key = feedKey(params.symbol, params.resolution);
  const state = feeds.get(key);
  if (!state || state.candles.length === 0) return null;
  return {
    candles: [...state.candles],
    lastPrice: state.lastPrice,
  };
}

export function subscribeHedgeScalpingLiveTicks(params: {
  symbol: string;
  resolution: string;
  onTick: () => void;
}): () => void {
  const key = feedKey(params.symbol, params.resolution);
  const state = feeds.get(key);
  if (!state) return () => {};
  state.subscribers.add(params.onTick);
  return () => state.subscribers.delete(params.onTick);
}
