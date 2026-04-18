"use client";

import { useEffect, useState } from "react";

import { isHedgeScalpingStrategySlug } from "@/lib/hedge-scalping-config";
import { formatUsdAmount } from "@/lib/format-inr";
import type {
  AdminLivePositionRow,
  AdminStrategyStatusRow,
} from "@/server/queries/active-positions-dashboard";

function signedUsdText(v: number): string {
  const absTxt = formatUsdAmount(String(Math.abs(v)));
  return v < 0 ? `-${absTxt}` : absTxt;
}

function formatExitPx(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
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
  if (row.d2LadderStep != null) {
    const n = row.activeClipCount != null && row.activeClipCount > 1 ? ` · ${row.activeClipCount} clips` : "";
    return `D2 · Step ${row.d2LadderStep}${n}`;
  }
  if (row.activeClipCount != null) {
    return `D2 (Active Clips: ${row.activeClipCount})`;
  }
  return "D2";
}

function strategyContextLabel(row: AdminLivePositionRow): string {
  if (isHedgeScalpingStrategySlug(row.strategySlug)) {
    return "Hedge scalping · HalfTrend + bar-driven virtual poller";
  }
  return "—";
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
          <table className="min-w-[1220px] w-full text-left text-xs text-slate-200">
            <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 min-w-[140px]">Strategy context</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Trader</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Entry</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Stop loss</th>
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
                  <td className="px-3 py-2 align-top text-slate-400 text-[10px] leading-snug">
                    {strategyContextLabel(row)}
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
                  <td className="px-3 py-2 tabular-nums text-slate-300">{formatExitPx(row.targetPrice)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">{formatExitPx(row.stopLossPrice)}</td>
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
