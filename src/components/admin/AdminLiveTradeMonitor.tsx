"use client";

import { useEffect, useState } from "react";

import { formatUsdAmount } from "@/lib/format-inr";
import {
  TREND_ARB_D1_TP_PCT,
  TREND_ARB_HEDGE_STEP_PCT,
} from "@/server/trading/ta-engine/trend-arb-constants";
import type {
  AdminLivePositionRow,
  AdminStrategyStatusRow,
} from "@/server/queries/active-positions-dashboard";

function livePnlPct(row: Pick<AdminLivePositionRow, "avgEntryPrice" | "markPrice" | "side">): number | null {
  if (!(row.avgEntryPrice != null && row.avgEntryPrice > 0 && row.markPrice != null && row.markPrice > 0)) {
    return null;
  }
  const raw = ((row.markPrice - row.avgEntryPrice) / row.avgEntryPrice) * 100;
  return row.side === "long" ? raw : -raw;
}

function StrategyPulseCell({
  pulse,
  row,
}: {
  pulse: NonNullable<AdminLivePositionRow["strategyPulse"]>;
  row?: AdminLivePositionRow;
}) {
  const isActiveD1 = row?.account === "D1" && pulse.d1Status === "Active";
  if (isActiveD1 && row) {
    const pnlPct = livePnlPct(row);
    const stepPct = TREND_ARB_HEDGE_STEP_PCT * 100;
    const stepNow = pnlPct != null && Number.isFinite(pnlPct) ? Math.max(0, pnlPct) : 0;
    const nextStepMultiple = Math.floor(stepNow / stepPct) + 1;
    const entry = row.avgEntryPrice ?? 0;
    const mark = row.markPrice ?? 0;
    const targetTp =
      row.side === "long"
        ? entry * (1 + TREND_ARB_D1_TP_PCT)
        : entry * (1 - TREND_ARB_D1_TP_PCT);
    const nextHedgeTarget =
      row.side === "long"
        ? entry * (1 + (TREND_ARB_HEDGE_STEP_PCT * nextStepMultiple))
        : entry * (1 - (TREND_ARB_HEDGE_STEP_PCT * nextStepMultiple));
    const remainingMovePct =
      mark > 0 ? Math.abs(((nextHedgeTarget - mark) / mark) * 100) : NaN;
    const pnlStr = pnlPct == null ? "N/A" : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`;
    const remainingStr = Number.isFinite(remainingMovePct)
      ? `${remainingMovePct.toFixed(2)}%`
      : "N/A";

    return (
      <ul className="list-none space-y-2 text-[10px] leading-snug">
        <li className="text-emerald-400/95">
          <span className="mr-1">✅</span>
          D1 State:{" "}
          <span className="font-semibold text-slate-100">
            [Active {row.side === "long" ? "Long" : "Short"}]
          </span>
        </li>
        <li className={pnlPct != null && pnlPct >= 0 ? "text-emerald-400/95" : "text-orange-300/95"}>
          <span className="mr-1">{pnlPct != null && pnlPct >= 0 ? "✅" : "⏳"}</span>
          Current PnL: <span className="font-semibold tabular-nums text-slate-100">[{pnlStr}]</span>
        </li>
        <li className="text-sky-300/95">
          <span className="mr-1">⏳</span>
          Next D2 Hedge:{" "}
          <span className="font-semibold tabular-nums text-slate-100">
            [{nextHedgeTarget > 0 ? nextHedgeTarget.toFixed(2) : "N/A"}]{" "}
            <span className="text-slate-300">(Remaining: {remainingStr})</span>
          </span>
        </li>
        <li className="text-emerald-400/95">
          <span className="mr-1">✅</span>
          Target:{" "}
          <span className="font-semibold tabular-nums text-slate-100">
            [{targetTp > 0 ? targetTp.toFixed(2) : "N/A"}]
          </span>
        </li>
      </ul>
    );
  }

  const h = pulse.history;
  const historyReady = pulse.barsReady === "OK" && h.closedBars >= h.targetBars;
  const trendLabel = pulse.trendDirection;
  const priceLabel = pulse.priceVsHt;
  const trendPriceAligned =
    (trendLabel === "Long" && priceLabel === "Above") ||
    (trendLabel === "Short" && priceLabel === "Below");
  const priceColorClass = trendPriceAligned ? "text-emerald-400/95" : "text-orange-300/95";

  const historyLine = historyReady ? (
    <span className="text-emerald-400/95">
      <span className="mr-1">✅</span>
      Bars:{" "}
      <span className="font-semibold tabular-nums">
        [{h.targetBars}/{h.targetBars} OK]
      </span>
      <span className="text-emerald-500/80"> (loaded {h.closedBars} closed)</span>
      <span className="ml-1 font-mono text-[9px] text-emerald-600/90">· raw {h.rawBars}</span>
      <span className="ml-1 font-mono text-[9px] text-emerald-700/80">{h.symbolFetched}</span>
    </span>
  ) : (
    <span className="text-amber-300/95">
      <span className="mr-1">⏳</span>
      Bars:{" "}
      <span className="font-semibold tabular-nums text-amber-100">
        [{h.closedBars}/{h.targetBars}]
      </span>{" "}
      — need closed history (raw {h.rawBars})
      <br />
      <span className="font-mono text-[9px] text-amber-200/80">
        {h.symbolRequested} → {h.symbolFetched}
      </span>
    </span>
  );

  return (
    <ul className="list-none space-y-2 text-[10px] leading-snug">
      <li>{historyLine}</li>
      <li className="text-slate-200">
        <span className="mr-1">✅</span>
        Trend:{" "}
        <span className="font-semibold tabular-nums text-slate-100">[{trendLabel}]</span>
      </li>
      <li className={priceColorClass}>
        <span className="mr-1">{trendPriceAligned ? "✅" : "⏳"}</span>
        Price vs HT:{" "}
        <span className="font-semibold tabular-nums text-slate-100">[{priceLabel}]</span>
      </li>
      <li className={pulse.d1Status === "Active" ? "text-emerald-400/95" : "text-amber-300/95"}>
        <span className="mr-1">{pulse.d1Status === "Active" ? "✅" : "⏳"}</span>
        D1 Entry:{" "}
        <span className="font-semibold text-slate-100">
          [{pulse.d1Status === "Active" ? "Active" : "Crossover Wait"}]
        </span>
      </li>
    </ul>
  );
}

function signedUsdText(v: number): string {
  const absTxt = formatUsdAmount(String(Math.abs(v)));
  return v < 0 ? `-${absTxt}` : absTxt;
}

function sideFromNetQty(side: "long" | "short", netQty: number): "long" | "short" {
  if (Number.isFinite(netQty) && Math.abs(netQty) > 1e-10) {
    return netQty > 0 ? "long" : "short";
  }
  return side;
}

function formatPct(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}%`;
}

function qtyDisplay(netQty: number, qtyPctOfCapital: number | null): string {
  const pct = formatPct(qtyPctOfCapital);
  return pct ? `${netQty.toFixed(6)} (${pct})` : netQty.toFixed(6);
}

function accountLabel(row: AdminLivePositionRow): string {
  if (row.account === "D1") return "D1";
  if (row.activeClipCount != null) {
    return `D2 (Active Clips: ${row.activeClipCount})`;
  }
  return "D2";
}

async function closeRunAndRefresh(params: {
  runId: string;
  mode: "virtual" | "real";
  refresh: () => Promise<void>;
}): Promise<void> {
  const yes = window.confirm("Are you sure you want to market close all legs for this strategy?");
  if (!yes) return;
  const res = await fetch("/api/trading/close-strategy-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: params.runId, mode: params.mode }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Could not close position.");
  }
  await params.refresh();
}

export function AdminLiveTradeMonitor({
  initialRows,
  initialStatusRows,
}: {
  initialRows: AdminLivePositionRow[];
  initialStatusRows: AdminStrategyStatusRow[];
}) {
  const [rows, setRows] = useState<AdminLivePositionRow[]>(initialRows);
  const [statusRows, setStatusRows] = useState<AdminStrategyStatusRow[]>(initialStatusRows);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);

  async function pull(): Promise<void> {
    try {
      const res = await fetch("/api/admin/active-positions", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 401 ? "Unauthorized." : "Could not refresh.");
        return;
      }
      const data = (await res.json()) as {
        rows: AdminLivePositionRow[];
        statusRows?: AdminStrategyStatusRow[];
        updatedAt?: string;
      };
      setRows(data.rows);
      setStatusRows(data.statusRows ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setError(null);
    } catch {
      setError("Network error.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void pull();
    const id = setInterval(() => {
      if (!cancelled) void pull();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
            Live trade monitor
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Virtual paper legs and live <code className="text-[var(--accent)]">bot_positions</code> with
            active subscription runs. Marks from Delta India public tickers; refresh ~every 8s.
          </p>
        </div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Live"}
          {error ? <span className="ml-2 text-amber-400/90">· {error}</span> : null}
        </p>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="min-w-[1100px] w-full text-left text-xs text-slate-200">
            <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 min-w-[140px]">Strategy pulse</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Trader</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Entry</th>
                <th className="px-3 py-2">Current</th>
                <th className="px-3 py-2">Live PnL</th>
                <th className="px-3 py-2">Realized PnL</th>
                <th className="px-3 py-2 min-w-[200px]">Participating users</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-white/[0.05] bg-black/20">
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{row.strategyName}</td>
                  <td className="px-3 py-2">{row.symbol}</td>
                  <td className="px-3 py-2 text-sky-200/90">
                    {accountLabel(row)}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-400">
                    {row.strategyPulse ? (
                      <StrategyPulseCell pulse={row.strategyPulse} row={row} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize text-slate-400">{row.mode}</td>
                  <td className="px-3 py-2 text-slate-300">{row.userLabel ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{sideFromNetQty(row.side, row.netQty)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {qtyDisplay(row.displayNetQty, row.qtyPctOfCapital)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {row.displayAvgEntryPrice != null ? row.displayAvgEntryPrice.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {row.markPrice != null ? row.markPrice.toFixed(2) : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums font-medium ${row.unrealizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100/90"}`}
                  >
                    {signedUsdText(row.unrealizedPnlUsd)}
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums font-medium ${row.realizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100/90"}`}
                  >
                    {signedUsdText(row.realizedPnlUsd)}
                  </td>
                  <td className="px-3 py-2 text-[11px] leading-snug text-slate-400">
                    {row.participatingUsers}
                  </td>
                  <td className="px-3 py-2">
                    {(row.mode === "virtual" && row.virtualRunId) || (row.mode === "real" && row.runId) ? (
                      <button
                        type="button"
                        disabled={closingKey === row.key}
                        onClick={() => {
                          const runId = row.mode === "virtual" ? row.virtualRunId : row.runId;
                          if (!runId) return;
                          setClosingKey(row.key);
                          void closeRunAndRefresh({
                            runId,
                            mode: row.mode,
                            refresh: pull,
                          })
                            .catch((e) => {
                              const msg = e instanceof Error ? e.message : String(e);
                              setError(msg);
                            })
                            .finally(() => setClosingKey(null));
                        }}
                        className="rounded-md border border-red-500/60 bg-red-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-200 hover:bg-red-500/25 disabled:opacity-60"
                      >
                        {closingKey === row.key ? "Closing..." : "Close Position"}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : statusRows.length > 0 ? (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="min-w-[900px] w-full text-left text-xs text-slate-200">
              <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2 min-w-[220px]">Traders</th>
                  <th className="px-3 py-2 min-w-[180px]">Strategy Pulse</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.key} className="border-t border-white/[0.05] bg-black/20">
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                      {row.strategyName}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-400">{row.mode}</td>
                    <td className="px-3 py-2 text-[11px] leading-snug text-slate-400">
                      {row.participatingUsers || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-400">
                      <StrategyPulseCell pulse={row.strategyPulse} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          No open legs or active strategy subscriptions right now.
        </p>
      )}
    </div>
  );
}
