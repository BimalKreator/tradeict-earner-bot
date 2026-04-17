import WebSocket from "ws";

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
  symbol: string;
  resolution: string;
  resSec: number;
  candles: OhlcvCandle[];
  lastPrice: number | null;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Set<() => void>;
  seeded: boolean;
};

const feeds = new Map<FeedKey, FeedState>();

function feedKey(symbol: string, resolution: string): FeedKey {
  return `${symbol.trim().toUpperCase()}::${resolution.trim().toLowerCase()}`;
}

function normalizeBinanceSymbol(raw: string): string {
  return raw.replace(/_/g, "").toLowerCase();
}

function websocketUrlFor(symbol: string): string {
  const s = normalizeBinanceSymbol(symbol);
  // Trade stream gives sub-second updates so we can keep forming candle close in sync.
  return `wss://stream.binance.com:9443/ws/${s}@trade`;
}

function rollTickIntoCandle(state: FeedState, params: { price: number; qty: number; tsMs: number }): void {
  const tsSec = Math.floor(params.tsMs / 1000);
  const bucketTime = Math.floor(tsSec / state.resSec) * state.resSec;
  const price = params.price;
  const vol = Number.isFinite(params.qty) ? Math.max(0, params.qty) : 0;
  const last = state.candles[state.candles.length - 1];
  if (!last || last.time < bucketTime) {
    state.candles.push({
      time: bucketTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: vol,
    });
  } else if (last.time === bucketTime) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume = Math.max(0, last.volume + vol);
  }
  // Prevent unbounded memory growth.
  if (state.candles.length > 2500) {
    state.candles.splice(0, state.candles.length - 2500);
  }
  state.lastPrice = price;
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
    state.lastPrice = candles[candles.length - 1]!.close;
  }
  state.seeded = true;
}

function notify(state: FeedState): void {
  for (const fn of state.subscribers) fn();
}

function connect(state: FeedState): void {
  const ws = new WebSocket(websocketUrlFor(state.symbol));
  state.ws = ws;

  ws.on("message", (raw) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      const data = JSON.parse(text) as { p?: string; q?: string; T?: number };
      const price = Number(data.p ?? "");
      const qty = Number(data.q ?? "");
      const tsMs = Number(data.T ?? Date.now());
      if (!(Number.isFinite(price) && price > 0)) return;
      rollTickIntoCandle(state, { price, qty, tsMs });
      notify(state);
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    state.ws = null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => connect(state), 2000);
  });

  ws.on("error", () => {
    try {
      ws.close();
    } catch {
      // noop
    }
  });
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
      symbol: normalizeDeltaCandlesSymbol(params.baseUrl, params.symbol),
      resolution: params.resolution,
      resSec: Math.max(60, resolutionToSeconds(params.resolution)),
      candles: [],
      lastPrice: null,
      ws: null,
      reconnectTimer: null,
      subscribers: new Set(),
      seeded: false,
    };
    feeds.set(key, state);
  }
  await seedFromRest(state, params.baseUrl, params.lookbackSec);
  if (!state.ws) connect(state);
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
