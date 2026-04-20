"use client";

import { useEffect, useState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatUsdAmount } from "@/lib/format-inr";
import type {
  AdminLiveOpenPositionRow,
  LiveOpenPositionRow,
} from "@/server/queries/live-positions-dashboard";

function signedUsdText(v: number): string {
  const absTxt = formatUsdAmount(String(Math.abs(v)));
  return v < 0 ? `-${absTxt}` : absTxt;
}

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

function contractsText(qty: number): string {
  const a = Math.abs(qty);
  if (Number.isInteger(a) || Math.abs(a - Math.round(a)) < 1e-6) {
    return String(Math.round(a));
  }
  return a.toFixed(4).replace(/\.?0+$/, "");
}

function unrealizedPnlPct(row: LiveOpenPositionRow): number | null {
  const usedMargin = row.usedMarginUsd;
  if (usedMargin == null || !Number.isFinite(usedMargin) || usedMargin <= 1e-12) return null;
  const pct = (row.unrealizedPnlUsd / usedMargin) * 100;
  return Number.isFinite(pct) ? pct : null;
}

function formatLivePnlWithPct(row: LiveOpenPositionRow): string {
  const usd = row.unrealizedPnlUsd;
  const absTxt = formatUsdAmount(String(Math.abs(usd)));
  const dollar = `${usd < 0 ? "-" : "+"}${absTxt}`;
  const p = unrealizedPnlPct(row);
  if (p == null) return dollar;
  const pctInner = `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
  return `${dollar} (${pctInner})`;
}

type Variant = "user" | "admin";

export function LivePositionsPanel({
  variant,
  initialRows,
}: {
  variant: Variant;
  initialRows: LiveOpenPositionRow[] | AdminLiveOpenPositionRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [reconciledAt, setReconciledAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const endpoint =
      variant === "user" ? "/api/user/live-positions" : "/api/admin/live-positions";

    async function pull(): Promise<void> {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) {
          setError(res.status === 401 ? "Session expired — refresh the page." : "Could not refresh.");
          return;
        }
        const data = (await res.json()) as {
          positions: LiveOpenPositionRow[] | AdminLiveOpenPositionRow[];
          updatedAt?: string;
          reconciledAt?: string | null;
        };
        setRows(data.positions);
        setUpdatedAt(data.updatedAt ?? null);
        setReconciledAt(data.reconciledAt ?? null);
        setError(null);
      } catch {
        setError("Network error while refreshing.");
      }
    }

    let cancelled = false;
    void pull();
    const id = setInterval(() => {
      if (!cancelled) void pull();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [variant]);

  const totalPnl = rows.reduce((s, r) => s + (r.unrealizedPnlUsd || 0), 0);

  const borderAccent =
    variant === "user"
      ? "border-sky-400/35 shadow-[0_0_40px_-8px_rgba(56,189,248,0.35)]"
      : "border-violet-400/35 shadow-[0_0_40px_-8px_rgba(167,139,250,0.3)]";
  const labelAccent = variant === "user" ? "text-sky-300/90" : "text-violet-200/90";
  const gradient =
    variant === "user"
      ? "from-sky-500/[0.14] via-[#0a1628] to-black/80"
      : "from-violet-500/[0.12] via-[#0a1628] to-black/80";

  if (rows.length === 0) {
    return (
      <GlassPanel className="border-white/[0.06]">
        <p className="text-sm text-[var(--text-muted)]">
          {variant === "user"
            ? "No open live positions. Flat bot books or inactive subscriptions are hidden here. Positions come from venue fills synced to bot_positions."
            : "No open live positions across approved users with active runs."}
        </p>
      </GlassPanel>
    );
  }

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border-2 ${borderAccent} bg-gradient-to-br ${gradient} p-1`}
    >
      <div className="rounded-[22px] border border-white/[0.08] bg-black/50 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${labelAccent}`}>
              {variant === "user" ? "Live · Delta India" : "Admin · Live book"}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Open positions
            </h2>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Data from <code className="text-sky-300/90">bot_positions</code> on active strategy runs.
              Marks use the Delta India public ticker (~8s). Live PnL is mark-to-market vs average entry
              when both are available; otherwise stored unrealized is shown.
            </p>
          </div>
          <div className="text-right">
            <p
              className={`text-sm font-semibold tabular-nums ${totalPnl < 0 ? "text-red-300" : "text-emerald-100"}`}
            >
              Σ Unrealized: {signedUsdText(totalPnl)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Live refresh"}
              {error ? <span className="ml-2 text-amber-400/90">· {error}</span> : null}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              {reconciledAt
                ? `Reconciled ${new Date(reconciledAt).toLocaleTimeString()}`
                : "Reconciliation pending"}
            </p>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-white/[0.07]">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="bg-black/50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                {variant === "admin" ? (
                  <th className="px-3 py-3 sm:px-4">User</th>
                ) : null}
                <th className="px-3 py-3 sm:px-4">Strategy</th>
                <th className="px-3 py-3 sm:px-4">Venue</th>
                <th className="px-3 py-3 sm:px-4">Symbol</th>
                <th className="px-3 py-3 sm:px-4">Side</th>
                <th className="px-3 py-3 sm:px-4">Qty (contracts)</th>
                <th className="px-3 py-3 sm:px-4">Reconcile</th>
                <th className="px-3 py-3 sm:px-4">Entry</th>
                <th className="px-3 py-3 sm:px-4">Mark</th>
                <th className="px-3 py-3 sm:px-4">Time</th>
                <th className="px-3 py-3 sm:px-4">Live PnL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-white/[0.06] bg-black/25">
                  {variant === "admin" ? (
                    <td className="px-3 py-3 text-slate-200 sm:px-4">
                      {(row as AdminLiveOpenPositionRow).userLabel ?? "—"}
                    </td>
                  ) : null}
                  <td className="px-3 py-3 font-semibold text-sky-100 sm:px-4">{row.strategyName}</td>
                  <td className="px-3 py-3 text-xs text-slate-400 sm:px-4">
                    {row.venueLabel ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-mono text-sm sm:px-4">{row.symbol}</td>
                  <td className="px-3 py-3 capitalize sm:px-4">{row.side}</td>
                  <td className="px-3 py-3 tabular-nums text-slate-200 sm:px-4">
                    {row.netQty < 0 ? "-" : ""}
                    {contractsText(row.netQty)}
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    {row.reconciliationStatus === "mismatch" ? (
                      <span
                        className="inline-flex items-center rounded-full border border-amber-300/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                        title={
                          row.exchangeNetQty != null
                            ? `Local=${row.netQty} Delta=${row.exchangeNetQty}`
                            : "Mismatch detected with Delta snapshot"
                        }
                      >
                        ⚠️ Mismatch
                      </span>
                    ) : row.reconciliationStatus === "matched" ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/80">
                        Matched
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">Unknown</span>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-slate-300 sm:px-4">
                    {row.avgEntryPrice != null ? row.avgEntryPrice.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-white sm:px-4">
                    {row.markPrice != null ? row.markPrice.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-400 sm:px-4">
                    {formatEntryOpenedAt(row.openedAt)}
                  </td>
                  <td
                    className={`px-3 py-3 tabular-nums text-base font-semibold sm:px-4 sm:text-lg ${row.unrealizedPnlUsd < 0 ? "text-red-300" : "text-emerald-100"}`}
                  >
                    {formatLivePnlWithPct(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
