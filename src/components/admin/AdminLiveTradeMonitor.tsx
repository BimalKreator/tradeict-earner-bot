"use client";

import { useEffect, useState } from "react";
import { useCallback } from "react";

import { isHedgeScalpingStrategySlug } from "@/lib/hedge-scalping-config";
import { isTrendProfitLockScalpingStrategySlug } from "@/lib/trend-profit-lock-config";
import { formatUsdAmount } from "@/lib/format-inr";
import { showAppToast } from "@/components/ui/GlobalToastHost";
import type {
  AdminLivePositionRow,
  AdminUpcomingEventRow,
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

function eventStatusBadge(status: "completed" | "waiting" | "submitting"): string {
  if (status === "completed") return "text-emerald-200";
  if (status === "submitting") return "text-sky-200";
  return "text-amber-200";
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
}): Promise<{ requestId: string | null }> {
  const yes = window.confirm("Are you sure you want to market close all legs for this strategy?");
  if (!yes) return { requestId: null };
  const res = await fetch("/api/trading/close-strategy-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: params.runId, mode: params.mode }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; requestId?: string };
  if (!res.ok) {
    throw new Error(data.error || "Could not close position.");
  }
  await params.refresh();
  return { requestId: typeof data.requestId === "string" ? data.requestId : null };
}

export function AdminLiveTradeMonitor({
  initialRows,
  initialStatusRows,
  initialUpcomingEvents,
}: {
  initialRows: AdminLivePositionRow[];
  initialStatusRows: AdminStrategyStatusRow[];
  initialUpcomingEvents: AdminUpcomingEventRow[];
}) {
  const [rows, setRows] = useState<AdminLivePositionRow[]>(initialRows);
  const [statusRows, setStatusRows] = useState<AdminStrategyStatusRow[]>(initialStatusRows);
  const [upcomingEvents, setUpcomingEvents] = useState<AdminUpcomingEventRow[]>(initialUpcomingEvents);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [selectedMockRunId, setSelectedMockRunId] = useState<string>("");
  const [mockDirectionPending, setMockDirectionPending] = useState<"UP" | "DOWN" | null>(null);
  const [closeToast, setCloseToast] = useState<{
    requestId: string;
    status: "pending" | "success" | "failed";
    message: string;
  } | null>(null);

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
        upcomingEvents?: AdminUpcomingEventRow[];
        updatedAt?: string;
      };
      setRows(data.rows);
      setStatusRows(data.statusRows ?? []);
      setUpcomingEvents(data.upcomingEvents ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setError(null);
    } catch {
      setError("Network error.");
    }
  }

  async function triggerMockFlip(params: {
    runId?: string;
    direction: "UP" | "DOWN";
  }): Promise<void> {
    const payload: { direction: "UP" | "DOWN"; runId?: string } = {
      direction: params.direction,
    };
    const trimmedRunId = params.runId?.trim();
    if (trimmedRunId) payload.runId = trimmedRunId;
    const res = await fetch("/api/trading/mock-tpl-flip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || `Could not trigger mock flip ${params.direction}.`);
    }
  }

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
  }, []);

  const tplLiveRuns = rows
    .filter(
      (row) =>
        row.mode === "real" &&
        !!row.runId &&
        isTrendProfitLockScalpingStrategySlug(row.strategySlug),
    )
    .map((row) => ({ runId: row.runId as string, strategyName: row.strategyName }))
    .filter(
      (row, idx, arr) => arr.findIndex((x) => x.runId === row.runId) === idx,
    );

  useEffect(() => {
    if (tplLiveRuns.length === 0) {
      if (selectedMockRunId !== "") setSelectedMockRunId("");
      return;
    }
    if (selectedMockRunId === "") return;
    const stillPresent = tplLiveRuns.some((r) => r.runId === selectedMockRunId);
    if (!stillPresent) {
      setSelectedMockRunId("");
    }
  }, [tplLiveRuns, selectedMockRunId]);

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
        <div className="flex flex-wrap items-center gap-2">
          <>
            {tplLiveRuns.length > 0 ? (
              <select
                value={selectedMockRunId}
                onChange={(e) => setSelectedMockRunId(e.target.value)}
                className="rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[10px] text-slate-200"
              >
                <option value="">
                  Broadcast to All (Auto-Target)
                </option>
                {tplLiveRuns.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.strategyName} · {r.runId.slice(0, 8)}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              disabled={mockDirectionPending !== null}
              onClick={() => {
                setMockDirectionPending("UP");
                void triggerMockFlip({
                  runId: selectedMockRunId || undefined,
                  direction: "UP",
                })
                  .then(() => showAppToast("Mock Flip UP triggered!", "success"))
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    showAppToast(msg, "error");
                  })
                  .finally(() => setMockDirectionPending(null));
              }}
              className="rounded-md border border-emerald-500/60 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
            >
              {mockDirectionPending === "UP" ? "Mocking..." : "Mock UP"}
            </button>
            <button
              type="button"
              disabled={mockDirectionPending !== null}
              onClick={() => {
                setMockDirectionPending("DOWN");
                void triggerMockFlip({
                  runId: selectedMockRunId || undefined,
                  direction: "DOWN",
                })
                  .then(() => showAppToast("Mock Flip DOWN triggered!", "success"))
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    showAppToast(msg, "error");
                  })
                  .finally(() => setMockDirectionPending(null));
              }}
              className="rounded-md border border-violet-500/60 bg-violet-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200 hover:bg-violet-500/25 disabled:opacity-60"
            >
              {mockDirectionPending === "DOWN" ? "Mocking..." : "Mock DOWN"}
            </button>
          </>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Live"}
            {error ? <span className="ml-2 text-amber-400/90">· {error}</span> : null}
          </p>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <div
                key={`mobile-${row.key}`}
                className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 text-xs text-slate-200"
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">
                      {accountLabel(row)} · {row.symbol}
                    </p>
                    <p className="text-[10px] text-slate-400">{row.strategyName}</p>
                  </div>
                  <div className="text-right">
                    <p className="capitalize">{sideFromNetQty(row.side, row.netQty)}</p>
                    <p className="tabular-nums text-slate-300">
                      {qtyDisplay(row.displayNetQty, row.qtyPctOfCapital)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <p className="text-slate-400">Entry</p>
                  <p className="text-right tabular-nums text-slate-300">
                    {row.displayAvgEntryPrice != null ? row.displayAvgEntryPrice.toFixed(2) : "—"}
                  </p>
                  <p className="text-slate-400">Current</p>
                  <p className="text-right tabular-nums text-slate-300">
                    {row.markPrice != null ? row.markPrice.toFixed(2) : "—"}
                  </p>
                  <p className="text-slate-400">Target</p>
                  <p className="text-right tabular-nums text-slate-300">{formatExitPx(row.targetPrice)}</p>
                  <p className="text-slate-400">Stop loss</p>
                  <p className="text-right tabular-nums text-slate-300">{formatExitPx(row.stopLossPrice)}</p>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Live PnL</p>
                    <p
                      className={`tabular-nums text-sm font-semibold ${row.unrealizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100/90"}`}
                    >
                      {signedUsdText(row.unrealizedPnlUsd)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Realized</p>
                    <p
                      className={`tabular-nums text-[11px] font-medium ${row.realizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100/90"}`}
                    >
                      {signedUsdText(row.realizedPnlUsd)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="line-clamp-2 text-[10px] leading-snug text-slate-500">
                    {row.participatingUsers}
                  </p>
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
                          .then((result) => {
                            if (!result.requestId) return;
                            setCloseToast({
                              requestId: result.requestId,
                              status: row.mode === "real" ? "pending" : "success",
                              message:
                                row.mode === "real"
                                  ? "Close requested. Waiting for worker confirmation..."
                                  : "Virtual close completed.",
                            });
                            if (row.mode === "real") {
                              void pollManualCloseStatus(result.requestId);
                            }
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
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-white/[0.06] md:block">
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
                    <div className="flex flex-wrap items-center gap-2">
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
                              .then((result) => {
                                if (!result.requestId) return;
                                setCloseToast({
                                  requestId: result.requestId,
                                  status: row.mode === "real" ? "pending" : "success",
                                  message:
                                    row.mode === "real"
                                      ? "Close requested. Waiting for worker confirmation..."
                                      : "Virtual close completed.",
                                });
                                if (row.mode === "real") {
                                  void pollManualCloseStatus(result.requestId);
                                }
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
                      ) : null}
                      {!((row.mode === "virtual" && row.virtualRunId) || (row.mode === "real" && row.runId))
                        ? "—"
                        : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
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

      {upcomingEvents.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming events</h3>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="min-w-[1180px] w-full text-left text-xs text-slate-200">
              <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Accounts</th>
                  <th className="px-3 py-2">Stages</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Entry</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Stop loss</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Block Reason</th>
                </tr>
              </thead>
              <tbody>
                {upcomingEvents.map((e) => (
                  <tr key={e.key} className="border-t border-white/[0.05] bg-black/20">
                    <td className="px-3 py-2">
                      <p>{e.accountLabel}</p>
                      <p className="text-[10px] text-slate-500">{e.symbol}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{e.stageLabel}</td>
                    <td className="px-3 py-2">{e.side}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {e.eventType === "D2_STEP" ? formatExitPx(e.triggerPrice) : formatExitPx(e.entryPrice)}
                    </td>
                    <td className={`px-3 py-2 ${eventStatusBadge(e.entryStatus)}`}>
                      {e.entryStatus === "submitting" ? "Submitting" : e.entryStatus === "completed" ? "Completed" : "Waiting"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{e.quantity}</td>
                    <td className="px-3 py-2 tabular-nums">{formatExitPx(e.targetPrice)}</td>
                    <td className={`px-3 py-2 ${eventStatusBadge(e.targetStatus)}`}>
                      {e.targetStatus === "completed" ? "Completed" : "Waiting"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatExitPx(e.stopLossPrice)}</td>
                    <td className={`px-3 py-2 ${eventStatusBadge(e.stopLossStatus)}`}>
                      {e.stopLossStatus === "completed" ? "Completed" : "Waiting"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-400">
                      {e.blockReason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
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
    </div>
  );
}
