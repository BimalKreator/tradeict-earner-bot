"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const contracts = String(Math.round(Math.abs(netQty)));
  return pct ? `${contracts} (${pct})` : contracts;
}

function formatExitPx(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

/** HH:mm:ss, D Mon (local) */
function formatEntryOpenedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const mon = d.toLocaleString("en-GB", { month: "short" });
  return `${hh}:${mm}:${ss}, ${d.getDate()} ${mon}`;
}

function unrealizedPnlPctForLeg(leg: UserActivePositionGroup["legs"][number]): number | null {
  const usedMargin = leg.usedMarginUsd;
  if (usedMargin == null || !Number.isFinite(usedMargin) || usedMargin <= 1e-12) return null;
  const pct = (leg.unrealizedPnlUsd / usedMargin) * 100;
  return Number.isFinite(pct) ? pct : null;
}

function formatLivePnlWithPct(leg: UserActivePositionGroup["legs"][number]): string {
  const usd = leg.unrealizedPnlUsd;
  const absTxt = formatUsdAmount(String(Math.abs(usd)));
  const dollar = `${usd < 0 ? "-" : "+"}${absTxt}`;
  const p = unrealizedPnlPctForLeg(leg);
  if (p == null) return dollar;
  const pctInner = `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
  return `${dollar} (${pctInner})`;
}

function legLabel(
  leg: UserActivePositionGroup["legs"][number],
  g: Pick<UserActivePositionGroup, "isHedgeScalping">,
): string {
  if (g.isHedgeScalping) {
    if (leg.account === "D1") return "Anchor (D1)";
    if (leg.d2LadderStep != null) return `Scalp (Step ${leg.d2LadderStep})`;
    return "Scalp (D2)";
  }
  if (leg.account === "D1") return "D1";
  if (leg.d2LadderStep != null) {
    const n = leg.activeClipCount != null && leg.activeClipCount > 1 ? ` · ${leg.activeClipCount} clips` : "";
    return `D2 · Step ${leg.d2LadderStep}${n}`;
  }
  if (leg.activeClipCount != null) {
    return `D2 (Active Clips: ${leg.activeClipCount})`;
  }
  return "D2";
}

function closedLegLabel(
  leg: UserActivePositionGroup["closedLegs"][number],
  g: Pick<UserActivePositionGroup, "isHedgeScalping">,
): string {
  if (g.isHedgeScalping) {
    if (leg.account === "D1") return "Anchor (D1)";
    if (leg.d2LadderStep != null) return `Scalp (Step ${leg.d2LadderStep})`;
    return "Scalp (D2)";
  }
  return leg.account === "D1" ? "D1" : "D2";
}

export function UserActivePositionsSection({
  initialGroups,
  mode = "virtual",
  endpoint,
}: {
  initialGroups: UserActivePositionGroup[];
  mode?: "virtual" | "real";
  endpoint?: string;
}) {
  const [groups, setGroups] = useState<UserActivePositionGroup[]>(initialGroups);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closingRunId, setClosingRunId] = useState<string | null>(null);
  const [historyOpenByRun, setHistoryOpenByRun] = useState<Record<string, boolean>>({});
  const [historyPageByRun, setHistoryPageByRun] = useState<Record<string, number>>({});
  const [closeToast, setCloseToast] = useState<{
    requestId: string;
    status: "pending" | "success" | "failed";
    message: string;
  } | null>(null);
  const [exitToast, setExitToast] = useState<{ runId: string; message: string } | null>(null);
  const prevRunIdsRef = useRef<Set<string>>(new Set());
  const pollEndpoint = endpoint ?? (mode === "real" ? "/api/user/live-active-positions" : "/api/user/active-positions");

  const HISTORY_PAGE_SIZE = 5;

  const pull = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(pollEndpoint, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 401 ? "Session expired — refresh the page." : "Could not refresh.");
        return;
      }
      const data = (await res.json()) as {
        groups: UserActivePositionGroup[];
        updatedAt?: string;
      };
      const nextIds = new Set(data.groups.map((g) => g.runId));
      if (mode === "real") {
        const prev = prevRunIdsRef.current;
        if (prev.size > 0) {
          for (const rid of prev) {
            if (!nextIds.has(rid)) {
              try {
                const er = await fetch(
                  `/api/user/trade-exit-summary?runId=${encodeURIComponent(rid)}`,
                  { cache: "no-store" },
                );
                if (er.ok) {
                  const ex = (await er.json()) as { reasonLabel?: string; reason?: string };
                  const label =
                    ex.reasonLabel && ex.reasonLabel.length > 0
                      ? ex.reasonLabel
                      : "Position closed";
                  setExitToast({ runId: rid, message: label });
                } else {
                  setExitToast({ runId: rid, message: "Position closed" });
                }
              } catch {
                setExitToast({ runId: rid, message: "Position closed" });
              }
            }
          }
        }
        prevRunIdsRef.current = nextIds;
      } else {
        prevRunIdsRef.current = nextIds;
      }
      setGroups(data.groups);
      setUpdatedAt(data.updatedAt ?? null);
      setError(null);
    } catch {
      setError("Network error while refreshing.");
    }
  }, [pollEndpoint, mode]);

  const pollManualCloseStatus = useCallback(async (requestId: string): Promise<void> => {
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(
          `/api/trading/manual-close-status?requestId=${encodeURIComponent(requestId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          setCloseToast({
            requestId,
            status: "failed",
            message: "Could not fetch close status.",
          });
          return;
        }
        const data = (await res.json()) as {
          status?: "pending" | "success" | "failed" | "not_found";
          message?: string;
          failureReason?: string | null;
        };
        if (data.status === "success") {
          setCloseToast({
            requestId,
            status: "success",
            message: data.message ?? "Close completed successfully.",
          });
          return;
        }
        if (data.status === "failed") {
          setCloseToast({
            requestId,
            status: "failed",
            message: data.failureReason
              ? `${data.message ?? "Close failed"}: ${data.failureReason}`
              : (data.message ?? "Close failed."),
          });
          return;
        }
      } catch {
        setCloseToast({
          requestId,
          status: "failed",
          message: "Network error while tracking close status.",
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setCloseToast({
      requestId,
      status: "pending",
      message: "Close still in progress. Check again shortly.",
    });
  }, []);

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
  }, [pull]);

  if (groups.length === 0) {
    return (
      <GlassPanel className="border-white/[0.06]">
        <p className="text-sm text-[var(--text-muted)]">
          {mode === "real"
            ? "No open live positions. Active live runs with a flat book are hidden here."
            : "No open simulated positions. Active paper runs with a flat book are hidden here."}
        </p>
      </GlassPanel>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl border-2 border-emerald-400/35 bg-gradient-to-br from-emerald-500/[0.14] via-[#0a1628] to-black/80 p-1 shadow-[0_0_40px_-8px_rgba(52,211,153,0.35)]">
      <div className="rounded-[22px] border border-white/[0.08] bg-black/50 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p
              className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${
                mode === "real" ? "text-sky-300/90" : "text-emerald-300/90"
              }`}
            >
              {mode === "real" ? "Live · Active positions" : "Paper · Active positions"}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Open D1 &amp; D2 legs
            </h2>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              {mode === "real" ? (
                <>
                  Live runs with <code className="text-sky-300/90">status = active</code> and open venue-synced
                  positions from <code className="text-sky-300/90">bot_positions</code>. Marks use the Delta India
                  public ticker (auto-refresh ~8s). <strong className="text-slate-200">Close Position</strong>{" "}
                  dispatches live market exits.
                </>
              ) : (
                <>
                  Simulated (virtual) runs with <code className="text-emerald-300/90">status = active</code> and an
                  open paper position — not your real Delta orders. Marks use the Delta India public ticker
                  (auto-refresh ~8s). <strong className="text-slate-200">Close Position</strong> settles the paper
                  book only.
                </>
              )}
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
            const displayPNL = openLegs.reduce((acc, leg) => acc + (leg.unrealizedPnlUsd || 0), 0);
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
                      {g.isHedgeScalping
                        ? "Hedge scalping · Anchor (D1) & scalp clips (D2)"
                        : "Open legs"}{" "}
                      · Run{" "}
                      <span className="font-mono text-[11px] text-slate-400">{g.runId.slice(0, 8)}…</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold tabular-nums ${displayPNL < 0 ? "text-red-300" : "text-emerald-100"}`}
                    >
                      Active PnL: {signedUsdText(displayPNL)}
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
                          body: JSON.stringify({ runId: g.runId, mode }),
                        })
                          .then(async (res) => {
                            const data = (await res.json().catch(() => ({}))) as {
                              error?: string;
                              requestId?: string;
                            };
                            if (!res.ok) {
                              throw new Error(data.error || "Could not close position.");
                            }
                            const rid = typeof data.requestId === "string" ? data.requestId : null;
                            if (rid) {
                              setCloseToast({
                                requestId: rid,
                                status: mode === "real" ? "pending" : "success",
                                message:
                                  mode === "real"
                                    ? "Close requested. Waiting for worker confirmation..."
                                    : "Virtual close completed.",
                              });
                              if (mode === "real") {
                                void pollManualCloseStatus(rid);
                              }
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
                        <th className="px-3 py-3 sm:px-4">Leg</th>
                        <th className="px-3 py-3 sm:px-4">Symbol</th>
                        <th className="px-3 py-3 sm:px-4">Side</th>
                        <th className="px-3 py-3 sm:px-4">Qty</th>
                        <th className="px-3 py-3 sm:px-4">Entry</th>
                        <th className="min-w-[4.25rem] px-3 py-3 sm:min-w-0 sm:px-4">Target</th>
                        <th className="min-w-[4.25rem] px-3 py-3 sm:min-w-0 sm:px-4">Stop loss</th>
                        <th className="px-3 py-3 sm:px-4">Current</th>
                        <th className="px-3 py-3 sm:px-4">Time</th>
                        <th className="px-3 py-3 sm:px-4">Live PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openLegs.length > 0 ? (
                        openLegs.map((leg) => (
                          <tr key={leg.key} className="border-t border-white/[0.06] bg-black/25">
                            <td className="px-3 py-3 font-semibold text-sky-200 sm:px-4">{legLabel(leg, g)}</td>
                            <td className="px-3 py-3 font-medium sm:px-4">{leg.symbol}</td>
                            <td className="px-3 py-3 capitalize sm:px-4">
                              {sideFromNetQty(leg.side, leg.netQty)}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-slate-300 sm:px-4">
                              {qtyDisplay(leg.displayNetQty, leg.qtyPctOfCapital)}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-slate-300 sm:px-4">
                              {leg.displayAvgEntryPrice != null ? leg.displayAvgEntryPrice.toFixed(2) : "—"}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-slate-200 sm:px-4">
                              {formatExitPx(leg.targetPrice)}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-slate-200 sm:px-4">
                              {formatExitPx(leg.stopLossPrice)}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-white sm:px-4">
                              {leg.markPrice != null ? leg.markPrice.toFixed(2) : "—"}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-300 sm:px-4">
                              {formatEntryOpenedAt(leg.openedAt)}
                            </td>
                            <td
                              className={`px-3 py-3 tabular-nums text-base font-semibold sm:px-4 sm:text-lg ${leg.unrealizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                            >
                              {formatLivePnlWithPct(leg)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t border-white/[0.06] bg-black/25">
                          <td colSpan={10} className="px-4 py-4 text-sm text-slate-400">
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
                                    {closedLegLabel(leg, g)}
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
      {closeToast ? (
        <div className="fixed right-4 bottom-4 z-50 w-[min(92vw,460px)] rounded-xl border border-white/15 bg-black/85 px-4 py-3 text-xs shadow-2xl backdrop-blur">
          <p className="font-semibold text-slate-100">
            Close request {closeToast.status === "pending" ? "in progress" : closeToast.status}
          </p>
          <p className="mt-1 font-mono text-[10px] text-sky-300/90">{closeToast.requestId}</p>
          <p
            className={`mt-2 ${
              closeToast.status === "failed"
                ? "text-red-300"
                : closeToast.status === "success"
                  ? "text-emerald-200"
                  : "text-slate-300"
            }`}
          >
            {closeToast.message}
          </p>
          <div className="mt-2 text-right">
            <button
              type="button"
              className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-white/10"
              onClick={() => setCloseToast(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {exitToast ? (
        <div className="fixed right-4 bottom-24 z-50 w-[min(92vw,460px)] rounded-xl border border-emerald-500/30 bg-black/85 px-4 py-3 text-xs shadow-2xl backdrop-blur">
          <p className="font-semibold text-emerald-100">Trade exited: {exitToast.message}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">{exitToast.runId.slice(0, 8)}…</p>
          <div className="mt-2 text-right">
            <button
              type="button"
              className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-white/10"
              onClick={() => setExitToast(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
