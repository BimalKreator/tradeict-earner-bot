import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { trendArbStrategyConfigSchema } from "@/lib/trend-arb-strategy-config";
import { db } from "@/server/db";
import { strategies } from "@/server/db/schema";
import { virtualBotOrders, virtualStrategyRuns } from "@/server/db/schema";

import { calculateHalfTrend } from "./indicators/halftrend";
import {
  computeTrendArbLookbackSeconds,
  fetchDeltaExchangeCandles,
  filterClosedCandles,
  normalizeDeltaCandlesSymbol,
  resolutionToSeconds,
  TREND_ARB_TARGET_CLOSED_BARS,
} from "./rsi-scalper";

export type TrendArbPulseHistory = {
  targetBars: number;
  rawBars: number;
  closedBars: number;
  symbolRequested: string;
  symbolFetched: string;
};

export type TrendArbMarketPulse = {
  barsReady: "OK" | "Pending";
  trendDirection: "Long" | "Short";
  priceVsHt: "Above" | "Below";
  /** Latest closed bar had a HalfTrend buy or sell signal (worker entry gate). */
  hasEntrySignalBar: boolean;
  history: TrendArbPulseHistory;
  /**
   * Optional: latest open D1 info pulled from `virtual_strategy_runs`.
   * Used to keep admin/user dashboards aligned with worker PnL math.
   */
  d1EntryPrice?: number | null;
  d1Side?: "long" | "short" | null;
};

const pulseCache = new Map<string, { at: number; value: TrendArbMarketPulse | null }>();
const PULSE_TTL_MS = 45_000;

function defaultBaseUrl(): string {
  return process.env.TA_TREND_ARB_DELTA_BASE_URL?.trim() || "https://api.delta.exchange";
}

async function loadTrendArbSymbolAndIndicator(strategyId: string): Promise<{
  symbol: string;
  amplitude: number;
  channelDeviation: number;
  timeframe: string;
} | null> {
  if (!db) return null;
  const [row] = await db
    .select({ settingsJson: strategies.settingsJson })
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), isNull(strategies.deletedAt)))
    .limit(1);
  const parsed = trendArbStrategyConfigSchema.safeParse(row?.settingsJson ?? null);
  if (!parsed.success) return null;
  const cfg = parsed.data;
  return {
    symbol: cfg.symbol,
    amplitude: Math.max(2, Math.round(cfg.indicatorSettings.amplitude ?? 9)),
    channelDeviation: Math.max(1, Math.round(cfg.indicatorSettings.channelDeviation ?? 2)),
    timeframe: cfg.indicatorSettings.timeframe ?? "4h",
  };
}

function emptyHistory(symbolRequested: string, baseUrl: string): TrendArbPulseHistory {
  return {
    targetBars: Math.max(TREND_ARB_TARGET_CLOSED_BARS, 101),
    rawBars: 0,
    closedBars: 0,
    symbolRequested,
    symbolFetched: normalizeDeltaCandlesSymbol(baseUrl, symbolRequested),
  };
}

async function loadLatestVirtualD1ForStrategy(
  strategyId: string,
): Promise<{ d1EntryPrice: number | null; d1Side: "long" | "short" | null } | null> {
  if (!db) return null;

  const [latest] = await db
    .select({
      virtualRunId: virtualStrategyRuns.id,
      openNetQty: virtualStrategyRuns.openNetQty,
      openAvgEntryPrice: virtualStrategyRuns.openAvgEntryPrice,
    })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.strategyId, strategyId),
        eq(virtualStrategyRuns.status, "active"),
        sql`abs(cast(${virtualStrategyRuns.openNetQty} as numeric)) > 0`,
      ),
    )
    .orderBy(desc(virtualStrategyRuns.updatedAt))
    .limit(1);

  if (!latest) return null;

  const openNetQty = Number(latest.openNetQty ?? "0");
  const entryFromRun = Number(latest.openAvgEntryPrice ?? "0");
  const d1Side = openNetQty > 0 ? "long" : openNetQty < 0 ? "short" : null;

  // Prefer the engine’s stored avg entry for the open virtual D1 position.
  if (entryFromRun > 0) {
    return { d1EntryPrice: entryFromRun, d1Side };
  }

  // Fallback: use the latest filled virtual fill price (entry) if avg-entry wasn’t populated.
  const [lastFill] = await db
    .select({ fillPrice: virtualBotOrders.fillPrice })
    .from(virtualBotOrders)
    .where(
      and(
        eq(virtualBotOrders.virtualRunId, latest.virtualRunId),
        sql`${virtualBotOrders.status} in ('filled', 'partial_fill')`,
        eq(virtualBotOrders.signalAction, "entry"),
      ),
    )
    .orderBy(desc(virtualBotOrders.createdAt))
    .limit(1);

  const d1EntryPrice = lastFill ? Number(lastFill.fillPrice ?? "0") : null;
  return { d1EntryPrice: d1EntryPrice && d1EntryPrice > 0 ? d1EntryPrice : null, d1Side };
}

/**
 * Market-level HalfTrend snapshot for admin “Strategy Pulse” (cached briefly per strategy).
 */
export async function getTrendArbMarketPulse(strategyId: string): Promise<TrendArbMarketPulse | null> {
  const now = Date.now();
  const cached = pulseCache.get(strategyId);
  if (cached && now - cached.at < PULSE_TTL_MS) {
    return cached.value;
  }

  const cfg = await loadTrendArbSymbolAndIndicator(strategyId);
  if (!cfg) {
    pulseCache.set(strategyId, { at: now, value: null });
    return null;
  }

  const baseUrl = defaultBaseUrl();
  const symbolRequested = cfg.symbol;
  const symbolFetched = normalizeDeltaCandlesSymbol(baseUrl, symbolRequested);
  const resSec = resolutionToSeconds(cfg.timeframe);
  const lookbackSec = computeTrendArbLookbackSeconds(resSec, TREND_ARB_TARGET_CLOSED_BARS);
  const minBars = Math.max(TREND_ARB_TARGET_CLOSED_BARS, 101, cfg.amplitude + 2);

  const historyBase: TrendArbPulseHistory = {
    targetBars: minBars,
    rawBars: 0,
    closedBars: 0,
    symbolRequested,
    symbolFetched,
  };

  let value: TrendArbMarketPulse | null = null;
  try {
    const candles = await fetchDeltaExchangeCandles({
      baseUrl,
      symbol: symbolRequested,
      resolution: cfg.timeframe,
      lookbackSec,
    });
    const closed = filterClosedCandles(candles, resSec);
    historyBase.rawBars = candles.length;
    historyBase.closedBars = closed.length;

    if (closed.length < minBars) {
      const warm = Math.max(101, cfg.amplitude + 2);
      if (closed.length >= warm) {
        const half = calculateHalfTrend(closed, cfg.amplitude, cfg.channelDeviation);
        const bar = closed[closed.length - 1]!;
        const close = bar.close;
        const ht = half.htValue;
        value = {
          barsReady: "Pending",
          trendDirection: half.trend === 0 ? "Long" : "Short",
          priceVsHt:
            Number.isFinite(close) && Number.isFinite(ht)
              ? close >= ht
                ? "Above"
                : "Below"
              : "Below",
          hasEntrySignalBar: half.buySignal || half.sellSignal,
          history: { ...historyBase },
        };
      } else {
        value = {
          barsReady: "Pending",
          trendDirection: "Long",
          priceVsHt: "Below",
          hasEntrySignalBar: false,
          history: { ...historyBase },
        };
      }
    } else {
      const half = calculateHalfTrend(closed, cfg.amplitude, cfg.channelDeviation);
      const bar = closed[closed.length - 1]!;
      const close = bar.close;
      const ht = half.htValue;
      const trendDirection: "Long" | "Short" = half.trend === 0 ? "Long" : "Short";
      let priceVsHt: "Above" | "Below" = "Below";
      if (Number.isFinite(close) && Number.isFinite(ht)) {
        priceVsHt = close >= ht ? "Above" : "Below";
      }
      value = {
        barsReady: "OK",
        trendDirection,
        priceVsHt,
        hasEntrySignalBar: half.buySignal || half.sellSignal,
        history: { ...historyBase },
      };
    }
  } catch {
    value = {
      barsReady: "Pending",
      trendDirection: "Long",
      priceVsHt: "Below",
      hasEntrySignalBar: false,
      history: emptyHistory(symbolRequested, baseUrl),
    };
  }

  if (value) {
    const latestVirtualD1 = await loadLatestVirtualD1ForStrategy(strategyId);
    if (latestVirtualD1) {
      value = {
        ...value,
        d1EntryPrice: latestVirtualD1.d1EntryPrice,
        d1Side: latestVirtualD1.d1Side,
      };
    }
  }
  pulseCache.set(strategyId, { at: now, value });
  return value;
}
