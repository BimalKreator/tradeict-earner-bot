"use client";

import { useEffect, useState } from "react";

import { formatUsdAmount } from "@/lib/format-inr";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { UserActivePositionGroup } from "@/server/queries/active-positions-dashboard";

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

function legLabel(leg: UserActivePositionGroup["legs"][number]): string {
  if (leg.account === "D1") return "Delta 1";
  if (leg.activeClipCount != null) {
    return `Delta 2 (Active Clips: ${leg.activeClipCount})`;
  }
  return "Delta 2";
}

export function UserActivePositionsSection({
  initialGroups,
}: {
  initialGroups: UserActivePositionGroup[];
}) {
  const [groups, setGroups] = useState<UserActivePositionGroup[]>(initialGroups);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closingRunId, setClosingRunId] = useState<string | null>(null);
  const [historyOpenByRun, setHistoryOpenByRun] = useState<Record<string, boolean>>({});
  const [historyPageByRun, setHistoryPageByRun] = useState<Record<string, number>>({});

  const HISTORY_PAGE_SIZE = 5;

  async function pull(): Promise<void> {
    try {
      const res = await fetch("/api/user/active-positions", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 401 ? "Session expired — refresh the page." : "Could not refresh.");
        return;
      }
      const data = (await res.json()) as {
        groups: UserActivePositionGroup[];
        updatedAt?: string;
      };
      setGroups(data.groups);
      setUpdatedAt(data.updatedAt ?? null);
      setError(null);
    } catch {
      setError("Network error while refreshing.");
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

  if (groups.length === 0) {
    return (
      <GlassPanel className="border-white/[0.06]">
        <p className="text-sm text-[var(--text-muted)]">
          No open simulated positions. Active paper runs with a flat book are hidden here.
        </p>
      </GlassPanel>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border-2 border-emerald-400/35 bg-gradient-to-br from-emerald-500/[0.14] via-[#0a1628] to-black/80 p-1 shadow-[0_0_40px_-8px_rgba(52,211,153,0.35)]">
      <div className="rounded-[22px] border border-white/[0.08] bg-black/50 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/90">
              Live · Active positions
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Open D1 &amp; D2 legs
            </h2>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Paper runs with <code className="text-emerald-300/90">status = active</code> and an open
              simulated position. Entry from fills; <strong className="text-slate-200">current price</strong>{" "}
              from the Delta India public ticker (auto-refresh ~8s).
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Live refresh"}
              {error ? <span className="ml-2 text-amber-400/90">· {error}</span> : null}
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          {groups.map((g) => {
            const openLegs = g.legs.filter((leg) => Math.abs(leg.netQty) > 1e-10);
            const historyOpen = historyOpenByRun[g.runId] ?? false;
            const historyPage = Math.max(1, historyPageByRun[g.runId] ?? 1);
            const historyPageCount = Math.max(1, Math.ceil(g.closedLegs.length / HISTORY_PAGE_SIZE));
            const paginatedClosedLegs = g.closedLegs.slice(
              (historyPage - 1) * HISTORY_PAGE_SIZE,
              historyPage * HISTORY_PAGE_SIZE,
            );

            return (
              <div
                key={g.runId}
                className="rounded-2xl border border-emerald-500/20 bg-black/40 p-5 shadow-inner shadow-black/40"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{g.strategyName}</h3>
                    <p className="text-xs text-slate-500">
                      {g.isTrendArb ? "Trend arb · Delta 1 (primary) & Delta 2 (hedge)" : "Single account"} · Run{" "}
                      <span className="font-mono text-[11px] text-slate-400">{g.runId.slice(0, 8)}…</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold tabular-nums ${g.activePnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                    >
                      Active PnL: {signedUsdText(g.activePnlUsd)}
                    </p>
                    <p
                      className={`text-sm font-semibold tabular-nums ${g.realizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                    >
                      Realized PnL: {signedUsdText(g.realizedPnlUsd)}
                    </p>
                    <button
                      type="button"
                      disabled={closingRunId === g.runId}
                      onClick={() => {
                        const yes = window.confirm(
                          "Are you sure you want to market close all legs for this strategy?",
                        );
                        if (!yes) return;
                        setClosingRunId(g.runId);
                        void fetch("/api/trading/close-strategy-run", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ runId: g.runId, mode: "virtual" }),
                        })
                          .then(async (res) => {
                            if (!res.ok) {
                              const data = (await res.json().catch(() => ({}))) as { error?: string };
                              throw new Error(data.error || "Could not close position.");
                            }
                            await pull();
                          })
                          .catch((e) => {
                            const msg = e instanceof Error ? e.message : String(e);
                            setError(msg);
                          })
                          .finally(() => setClosingRunId(null));
                      }}
                      className="mt-2 rounded-md border border-red-500/60 bg-red-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-200 hover:bg-red-500/25 disabled:opacity-60"
                    >
                      {closingRunId === g.runId ? "Closing..." : "Close Position"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto rounded-xl border border-white/[0.07]">
                  <table className="min-w-full text-left text-sm text-slate-200">
                    <thead className="bg-black/50 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Leg</th>
                        <th className="px-4 py-3">Symbol</th>
                        <th className="px-4 py-3">Side</th>
                        <th className="px-4 py-3">Qty</th>
                        <th className="px-4 py-3">Entry</th>
                        <th className="px-4 py-3">Current price</th>
                        <th className="px-4 py-3">Live PnL</th>
                        <th className="px-4 py-3">Realized PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openLegs.length > 0 ? (
                        openLegs.map((leg) => (
                          <tr key={leg.key} className="border-t border-white/[0.06] bg-black/25">
                            <td className="px-4 py-3 font-semibold text-sky-200">{legLabel(leg)}</td>
                            <td className="px-4 py-3 font-medium">{leg.symbol}</td>
                            <td className="px-4 py-3 capitalize">{sideFromNetQty(leg.side, leg.netQty)}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-300">
                              {qtyDisplay(leg.displayNetQty, leg.qtyPctOfCapital)}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-slate-300">
                              {leg.displayAvgEntryPrice != null ? leg.displayAvgEntryPrice.toFixed(2) : "—"}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-white">
                              {leg.markPrice != null ? leg.markPrice.toFixed(2) : "—"}
                            </td>
                            <td
                              className={`px-4 py-3 tabular-nums text-lg font-semibold ${leg.unrealizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                            >
                              {signedUsdText(leg.unrealizedPnlUsd)}
                            </td>
                            <td
                              className={`px-4 py-3 tabular-nums font-semibold ${leg.realizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                            >
                              {signedUsdText(leg.realizedPnlUsd)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t border-white/[0.06] bg-black/25">
                          <td colSpan={8} className="px-4 py-4 text-sm text-slate-400">
                            No currently open legs for this run.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/20">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <h4 className="text-sm font-semibold text-white">Closed Legs History</h4>
                      <p className="text-xs text-slate-500">
                        {g.closedLegs.length} closed fill{g.closedLegs.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryOpenByRun((prev) => ({ ...prev, [g.runId]: !historyOpen }))
                      }
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300 hover:bg-white/10"
                    >
                      {historyOpen ? "Hide History" : "Show History"}
                    </button>
                  </div>

                  {historyOpen ? (
                    g.closedLegs.length > 0 ? (
                      <>
                        <div className="overflow-x-auto border-t border-white/[0.07]">
                          <table className="min-w-full text-left text-sm text-slate-200">
                            <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Leg</th>
                                <th className="px-4 py-3">Symbol</th>
                                <th className="px-4 py-3">Side</th>
                                <th className="px-4 py-3">Qty</th>
                                <th className="px-4 py-3">Exit price</th>
                                <th className="px-4 py-3">Realized PnL</th>
                                <th className="px-4 py-3">Closed</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedClosedLegs.map((leg) => (
                                <tr key={leg.key} className="border-t border-white/[0.06] bg-black/15">
                                  <td className="px-4 py-3 font-semibold text-sky-200">
                                    {leg.account === "D1" ? "Delta 1" : "Delta 2"}
                                  </td>
                                  <td className="px-4 py-3 font-medium">{leg.symbol}</td>
                                  <td className="px-4 py-3 capitalize">{leg.side}</td>
                                  <td className="px-4 py-3 tabular-nums text-slate-300">
                                    {qtyDisplay(leg.quantity, leg.qtyPctOfCapital)}
                                  </td>
                                  <td className="px-4 py-3 tabular-nums text-slate-300">
                                    {leg.fillPrice != null ? leg.fillPrice.toFixed(2) : "—"}
                                  </td>
                                  <td
                                    className={`px-4 py-3 tabular-nums font-semibold ${leg.realizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                                  >
                                    {signedUsdText(leg.realizedPnlUsd)}
                                  </td>
                                  <td className="px-4 py-3 text-slate-400">
                                    {new Date(leg.closedAt).toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-400">
                          <span>
                            Page {historyPage} of {historyPageCount}
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={historyPage <= 1}
                              onClick={() =>
                                setHistoryPageByRun((prev) => ({
                                  ...prev,
                                  [g.runId]: Math.max(1, historyPage - 1),
                                }))
                              }
                              className="rounded-md border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-50"
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              disabled={historyPage >= historyPageCount}
                              onClick={() =>
                                setHistoryPageByRun((prev) => ({
                                  ...prev,
                                  [g.runId]: Math.min(historyPageCount, historyPage + 1),
                                }))
                              }
                              className="rounded-md border border-white/10 bg-white/5 px-3 py-1 disabled:opacity-50"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="border-t border-white/[0.07] px-4 py-4 text-sm text-slate-400">
                        No closed legs recorded yet.
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
