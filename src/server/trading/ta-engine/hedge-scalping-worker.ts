import { and, desc, eq, isNull } from "drizzle-orm";

import {
  isHedgeScalpingStrategySlug,
  parseAllowedSymbolsList,
} from "@/lib/hedge-scalping-config";
import { db } from "@/server/db";
import { strategies } from "@/server/db/schema";

import {
  processHedgeScalpingActiveRunsPhase,
  processHedgeScalpingNewEntriesPhase,
} from "../hedge-scalping/poller";
import { parseHedgeScalpingStrategySettings } from "../hedge-scalping/load-hedge-scalping-config";
import { tradingLog } from "../trading-log";
import {
  computeChartLookbackSeconds,
  filterClosedCandles,
  resolutionToSeconds,
  TA_CHART_TARGET_CLOSED_BARS,
  type OhlcvCandle,
} from "./rsi-scalper";
import {
  ensureHedgeScalpingLiveFeed,
  getHedgeScalpingLiveSnapshot,
  subscribeHedgeScalpingLiveTicks,
} from "./hedge-scalping-live-feed";

export type HedgeScalpingWorkerFeedTarget = {
  symbol: string;
  resolution: string;
  baseUrl: string;
};

/** Single-feed override (tests / manual). */
export type HedgeScalpingWorkerEnv = {
  symbol: string;
  baseUrl: string;
  resolution: string;
  lookbackSec: number;
};

export type ReadHedgeScalpingWorkerEnvResult =
  | { kind: "disabled" }
  | { kind: "ok"; config: HedgeScalpingWorkerEnv }
  | { kind: "invalid"; error: string };

function hedgeScalpingWorkerExplicitlyDisabled(): boolean {
  const raw = (process.env.HS_WORKER_ENABLED ?? "").trim().toLowerCase();
  return raw === "false" || raw === "0" || raw === "no" || raw === "off";
}

export function readHedgeScalpingWorkerEnv(): ReadHedgeScalpingWorkerEnvResult {
  if (hedgeScalpingWorkerExplicitlyDisabled()) return { kind: "disabled" };
  const baseUrl =
    process.env.HS_WORKER_DELTA_BASE_URL?.trim() || "https://api.india.delta.exchange";
  const symbol = process.env.HS_WORKER_SYMBOL?.trim() || "BTCUSD";
  const resolution = process.env.HS_WORKER_RESOLUTION?.trim() || "5m";
  const lookbackSec =
    Number(process.env.HS_WORKER_LOOKBACK_SEC?.trim() || "172800") || 172_800;
  if (!symbol) return { kind: "invalid", error: "HS_WORKER_SYMBOL is empty." };
  return {
    kind: "ok",
    config: { symbol, baseUrl, resolution, lookbackSec },
  };
}

export type HedgeScalpingWorkerRuntime = {
  disabled: boolean;
  targets: HedgeScalpingWorkerFeedTarget[];
  lookbackSec: number;
};

/**
 * Builds one chart feed per unique (symbol, timeframe) from active Hedge Scalping strategies
 * (`general.allowedSymbols` × `general.timeframe`). Most recently updated strategy rows win
 * when deduping; `HS_WORKER_SYMBOL` limits to one venue symbol (still uses DB timeframe when possible).
 */
export async function resolveHedgeScalpingWorkerRuntime(): Promise<HedgeScalpingWorkerRuntime> {
  if (hedgeScalpingWorkerExplicitlyDisabled()) {
    return { disabled: true, targets: [], lookbackSec: 0 };
  }
  const lookbackSec =
    Number(process.env.HS_WORKER_LOOKBACK_SEC?.trim() || "172800") || 172_800;
  const baseUrlDefault =
    process.env.HS_WORKER_DELTA_BASE_URL?.trim() || "https://api.india.delta.exchange";
  const envSym = process.env.HS_WORKER_SYMBOL?.trim().toUpperCase() ?? "";

  const targets = await loadHedgeScalpingWorkerFeedTargetsFromDb({
    baseUrlDefault,
    envSymbolFilter: envSym.length > 0 ? envSym : null,
  });

  if (targets.length === 0) {
    const fallback = readHedgeScalpingWorkerEnv();
    if (fallback.kind === "ok") {
      const c = fallback.config;
      return {
        disabled: false,
        lookbackSec: Math.max(lookbackSec, c.lookbackSec),
        targets: [
          {
            symbol: c.symbol.trim().toUpperCase(),
            resolution: c.resolution.trim().toLowerCase(),
            baseUrl: c.baseUrl,
          },
        ],
      };
    }
    return {
      disabled: false,
      lookbackSec,
      targets: [
        {
          symbol: "BTCUSD",
          resolution: "5m",
          baseUrl: baseUrlDefault,
        },
      ],
    };
  }

  return { disabled: false, targets, lookbackSec };
}

async function loadHedgeScalpingWorkerFeedTargetsFromDb(params: {
  baseUrlDefault: string;
  envSymbolFilter: string | null;
}): Promise<HedgeScalpingWorkerFeedTarget[]> {
  if (!db) return [];
  const rows = await db
    .select({
      settingsJson: strategies.settingsJson,
      slug: strategies.slug,
    })
    .from(strategies)
    .where(and(isNull(strategies.deletedAt), eq(strategies.status, "active")))
    .orderBy(desc(strategies.updatedAt));

  const byKey = new Map<string, HedgeScalpingWorkerFeedTarget>();
  for (const row of rows) {
    if (!isHedgeScalpingStrategySlug(row.slug)) continue;
    const cfg = parseHedgeScalpingStrategySettings(row.settingsJson);
    if (!cfg) continue;
    const symbols = parseAllowedSymbolsList(cfg.general.allowedSymbols);
    const resolution = cfg.general.timeframe.trim().toLowerCase();
    for (const sym of symbols) {
      const key = `${sym.toUpperCase()}::${resolution}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        symbol: sym.toUpperCase(),
        resolution,
        baseUrl: params.baseUrlDefault,
      });
    }
  }

  let out = [...byKey.values()].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.resolution.localeCompare(b.resolution),
  );

  if (params.envSymbolFilter) {
    out = out.filter((t) => t.symbol === params.envSymbolFilter);
    if (out.length === 0) {
      const firstHs = rows.find((r) => isHedgeScalpingStrategySlug(r.slug));
      const cfg0 = firstHs
        ? parseHedgeScalpingStrategySettings(firstHs.settingsJson)
        : null;
      const resolution = (cfg0?.general.timeframe ?? "5m").trim().toLowerCase();
      out = [
        {
          symbol: params.envSymbolFilter,
          resolution,
          baseUrl: params.baseUrlDefault,
        },
      ];
    }
  }

  return out;
}

export type HedgeScalpingWorkerTickResult =
  | { ok: true; detail: string; candles?: OhlcvCandle[]; livePrice?: number | null }
  | { ok: false; error: string };

async function runHedgeScalpingWorkerForTargets(params: {
  targets: HedgeScalpingWorkerFeedTarget[];
  lookbackSec: number;
}): Promise<HedgeScalpingWorkerTickResult> {
  const { targets, lookbackSec } = params;
  if (targets.length === 0) {
    return { ok: true, detail: "No hedge-scalping feed targets configured." };
  }

  let anchorMark = 0;
  const minBars = Math.max(TA_CHART_TARGET_CLOSED_BARS, 50);
  const feedSummaries: string[] = [];
  type PreparedFeed = {
    target: HedgeScalpingWorkerFeedTarget;
    candles: OhlcvCandle[];
    mark: number;
  };
  const prepared: PreparedFeed[] = [];

  for (const t of targets) {
    const resSec = resolutionToSeconds(t.resolution);
    const minHistorySec = computeChartLookbackSeconds(resSec, TA_CHART_TARGET_CLOSED_BARS);
    const look = Math.max(lookbackSec, minHistorySec);

    try {
      await ensureHedgeScalpingLiveFeed({
        baseUrl: t.baseUrl,
        symbol: t.symbol,
        resolution: t.resolution,
        lookbackSec: look,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("warn", "hs_worker_feed_ensure_failed", {
        symbol: t.symbol,
        resolution: t.resolution,
        error: msg,
      });
      continue;
    }

    const snapshot = getHedgeScalpingLiveSnapshot({
      symbol: t.symbol,
      resolution: t.resolution,
    });
    if (!snapshot || snapshot.candles.length === 0) {
      feedSummaries.push(`${t.symbol}@${t.resolution}:waiting`);
      continue;
    }

    const closed = filterClosedCandles(snapshot.candles, resSec);
    if (closed.length < minBars) {
      feedSummaries.push(
        `${t.symbol}@${t.resolution}:bars=${closed.length}/${minBars}`,
      );
      continue;
    }

    const bar = snapshot.candles[snapshot.candles.length - 1]!;
    const barCloseLive =
      snapshot.lastPrice != null &&
      Number.isFinite(snapshot.lastPrice) &&
      snapshot.lastPrice > 0
        ? snapshot.lastPrice
        : bar.close;

    if (anchorMark <= 0 && barCloseLive > 0) {
      anchorMark = barCloseLive;
    }

    prepared.push({
      target: t,
      candles: snapshot.candles,
      mark: barCloseLive,
    });
    feedSummaries.push(
      `${t.symbol}@${t.resolution}(${snapshot.candles.length} bars, mark=${barCloseLive.toFixed(2)})`,
    );
  }

  const markForActive = anchorMark > 0 ? anchorMark : prepared[0]?.mark ?? 0;
  if (markForActive > 0) {
    try {
      await processHedgeScalpingActiveRunsPhase(markForActive);
    } catch (error) {
      console.error("[HS-POLLER-ERROR]", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  for (const p of prepared) {
    try {
      await processHedgeScalpingNewEntriesPhase(p.candles, p.mark, {
        symbol: p.target.symbol,
        resolution: p.target.resolution,
      });
    } catch (error) {
      console.error("[HS-POLLER-ERROR]", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    ok: true,
    detail: `Polled hedge scalping feeds: ${feedSummaries.join(" | ") || "no data yet"}`,
    livePrice: anchorMark > 0 ? anchorMark : null,
  };
}

/**
 * Refresh Delta candle snapshots (all configured symbol@timeframe feeds), then run the poller.
 * Pass `env` to force a single feed (legacy / tests).
 */
export async function runHedgeScalpingWorkerOnce(
  env?: HedgeScalpingWorkerEnv,
): Promise<HedgeScalpingWorkerTickResult> {
  if (env) {
    const c = env;
    const resSec = resolutionToSeconds(c.resolution);
    const minHistorySec = computeChartLookbackSeconds(resSec, TA_CHART_TARGET_CLOSED_BARS);
    const look = Math.max(c.lookbackSec, minHistorySec);
    let candles: OhlcvCandle[];
    let livePrice: number | null = null;
    try {
      await ensureHedgeScalpingLiveFeed({
        baseUrl: c.baseUrl,
        symbol: c.symbol,
        resolution: c.resolution,
        lookbackSec: look,
      });
      const snapshot = getHedgeScalpingLiveSnapshot({
        symbol: c.symbol,
        resolution: c.resolution,
      });
      if (snapshot && snapshot.candles.length > 0) {
        candles = snapshot.candles;
        livePrice = snapshot.lastPrice;
      } else {
        return { ok: true, detail: "Waiting for candle feed snapshot." };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("warn", "hs_worker_candles_failed", { error: msg });
      return { ok: false, error: msg };
    }

    const closed = filterClosedCandles(candles, resSec);
    const minBars = Math.max(TA_CHART_TARGET_CLOSED_BARS, 50);
    if (closed.length < minBars) {
      return {
        ok: true,
        detail: `Not enough closed candles (${closed.length}, need ${minBars}).`,
        candles,
        livePrice,
      };
    }

    const bar = candles[candles.length - 1]!;
    const barCloseLive =
      livePrice != null && Number.isFinite(livePrice) && livePrice > 0 ? livePrice : bar.close;

    try {
      await processHedgeScalpingActiveRunsPhase(barCloseLive);
      await processHedgeScalpingNewEntriesPhase(candles, barCloseLive, {
        symbol: c.symbol.trim().toUpperCase(),
        resolution: c.resolution.trim().toLowerCase(),
      });
    } catch (error) {
      console.error("[HS-POLLER-ERROR]", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    return {
      ok: true,
      detail: `Polled hedge scalping @ ${c.symbol} ${c.resolution} (${candles.length} bars, mark=${barCloseLive}).`,
      candles,
      livePrice: barCloseLive,
    };
  }

  const rt = await resolveHedgeScalpingWorkerRuntime();
  if (rt.disabled) {
    return {
      ok: true,
      detail: "HS_WORKER_ENABLED is false/0/no/off — hedge scalping worker ticks are skipped.",
    };
  }

  return runHedgeScalpingWorkerForTargets({
    targets: rt.targets,
    lookbackSec: rt.lookbackSec,
  });
}

type WorkerLoopState = {
  targets: HedgeScalpingWorkerFeedTarget[];
  lookbackSec: number;
  initDone: boolean;
};

export function startHedgeScalpingWorkerLoop(): NodeJS.Timeout {
  console.log("[HS-WORKER] Engine started successfully at " + new Date().toISOString());

  const INTERVAL_MS = Math.max(
    1_000,
    Number(process.env.HS_WORKER_INTERVAL_MS?.trim() || "1000") || 1_000,
  );
  tradingLog("info", "hs_worker_started", { intervalMs: INTERVAL_MS });

  const loopState: WorkerLoopState = {
    targets: [],
    lookbackSec: 172_800,
    initDone: false,
  };

  let running = false;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  const runTick = () => {
    if (!loopState.initDone || loopState.targets.length === 0) return;
    if (running) return;
    running = true;
    void runHedgeScalpingWorkerForTargets({
      targets: loopState.targets,
      lookbackSec: loopState.lookbackSec,
    })
      .catch((e) => {
        console.error("[hedge-scalping-worker] tick:", e);
      })
      .finally(() => {
        running = false;
      });
  };

  const scheduleCoalescedTick = () => {
    if (coalesceTimer != null) return;
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      runTick();
    }, 0);
  };

  void (async () => {
    const rt = await resolveHedgeScalpingWorkerRuntime();
    if (rt.disabled) {
      console.log(
        "[HS-WORKER] Disabled by env — HS_WORKER_ENABLED is false, 0, no, or off (unset or true runs the worker).",
      );
      loopState.initDone = true;
      return;
    }

    loopState.targets = rt.targets;
    loopState.lookbackSec = rt.lookbackSec;
    console.log(
      `[HS-WORKER] Loaded ${rt.targets.length} chart feed(s) from strategy config: ${rt.targets.map((t) => `${t.symbol}@${t.resolution}`).join(", ")}`,
    );

    for (const t of rt.targets) {
      const resSec = resolutionToSeconds(t.resolution);
      const minHistorySec = computeChartLookbackSeconds(resSec, TA_CHART_TARGET_CLOSED_BARS);
      await ensureHedgeScalpingLiveFeed({
        symbol: t.symbol,
        resolution: t.resolution,
        baseUrl: t.baseUrl,
        lookbackSec: Math.max(rt.lookbackSec, minHistorySec),
      });
      subscribeHedgeScalpingLiveTicks({
        symbol: t.symbol,
        resolution: t.resolution,
        onTick: scheduleCoalescedTick,
      });
    }

    loopState.initDone = true;
    scheduleCoalescedTick();
  })();

  const intervalTick = () => {
    if (!loopState.initDone) return;
    if (loopState.targets.length > 0) {
      for (const t of loopState.targets) {
        console.log(
          `[HS-WORKER] Heartbeat tick for symbol: ${t.symbol} @ ${t.resolution} (${resolutionToSeconds(t.resolution)}s bars)`,
        );
      }
    }
    scheduleCoalescedTick();
  };

  return setInterval(intervalTick, INTERVAL_MS);
}
