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

function seedCandleMeta(state: FeedState): void {
  if (state.candleMeta.size > 0 || state.candles.length === 0) return;
  for (const candle of state.candles) {
    const bucketStartMs = candle.time * 1000;
    // Historical REST bars are already finalized; seed with full-bucket bounds.
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
    seedCandleMeta(state);
    state.lastPrice = candles[candles.length - 1]!.close;
  }
  state.seeded = true;
}

function notify(state: FeedState): void {
  for (const fn of state.subscribers) fn();
}

async function refreshFromDelta(state: FeedState): Promise<void> {
  if (state.polling) return;
  state.polling = true;
  try {
    const candles = await fetchDeltaExchangeCandles({
      baseUrl: state.baseUrl,
      symbol: state.symbol,
      resolution: state.resolution,
      lookbackSec: Math.max(state.lookbackSec, state.resSec * MIN_SEED_BARS),
    });
    if (candles.length > 0) {
      state.candles = candles.slice(-2500);
      state.lastPrice = state.candles[state.candles.length - 1]!.close;
      seedCandleMeta(state);
      pruneCandleMeta(state);
      notify(state);
    }
  } catch {
    // swallow transient poll errors and keep previous snapshot
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

export async function ensureTrendArbLiveFeed(params: {
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

export function getTrendArbLiveSnapshot(params: {
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

export function subscribeTrendArbLiveTicks(params: {
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
