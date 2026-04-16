import { and, eq, isNull } from "drizzle-orm";

import { trendArbStrategyConfigSchema } from "@/lib/trend-arb-strategy-config";
import { db } from "@/server/db";
import { strategies } from "@/server/db/schema";

import { calculateHalfTrend } from "./indicators/halftrend";
import {
  computeTrendArbLookbackSeconds,
  fetchDeltaExchangeCandles,
  filterClosedCandles,
  resolutionToSeconds,
  TREND_ARB_TARGET_CLOSED_BARS,
} from "./rsi-scalper";

export type TrendArbMarketPulse = {
  barsReady: "OK" | "Pending";
  trendDirection: "Long" | "Short";
  priceVsHt: "Above" | "Below";
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

  const resSec = resolutionToSeconds(cfg.timeframe);
  const lookbackSec = computeTrendArbLookbackSeconds(resSec, TREND_ARB_TARGET_CLOSED_BARS);

  let value: TrendArbMarketPulse | null = null;
  try {
    const candles = await fetchDeltaExchangeCandles({
      baseUrl: defaultBaseUrl(),
      symbol: cfg.symbol,
      resolution: cfg.timeframe,
      lookbackSec,
    });
    const closed = filterClosedCandles(candles, resSec);
    const minBars = Math.max(TREND_ARB_TARGET_CLOSED_BARS, 101, cfg.amplitude + 2);
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
        };
      } else {
        value = {
          barsReady: "Pending",
          trendDirection: "Long",
          priceVsHt: "Below",
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
      };
    }
  } catch {
    value = {
      barsReady: "Pending",
      trendDirection: "Short",
      priceVsHt: "Below",
    };
  }

  pulseCache.set(strategyId, { at: now, value });
  return value;
}
