"use client";

import { useEffect, useState } from "react";

import { formatUsdAmount } from "@/lib/format-inr";
import type { AdminLivePositionRow } from "@/server/queries/active-positions-dashboard";

function StrategyPulseCell({ pulse }: { pulse: NonNullable<AdminLivePositionRow["strategyPulse"]> }) {
  const ok = pulse.barsReady === "OK";
  return (
    <ul className="list-none space-y-1 text-[10px] leading-snug text-slate-300">
      <li>
        Bars ready:{" "}
        <span className={ok ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
          {ok ? "OK" : "Pending"}
        </span>
      </li>
      <li>
        Trend:{" "}
        <span className="font-medium text-slate-100">{pulse.trendDirection}</span>
      </li>
      <li>
        Price vs HT:{" "}
        <span className="font-medium text-slate-100">{pulse.priceVsHt}</span>
      </li>
      <li>
        D1 status:{" "}
        <span
          className={
            pulse.d1Status === "Active" ? "font-semibold text-sky-300" : "font-semibold text-slate-400"
          }
        >
          {pulse.d1Status === "Active" ? "Active" : "Waiting"}
        </span>
      </li>
    </ul>
  );
}

function livePnlUsd(leg: {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
}): number {
  return leg.realizedPnlUsd + leg.unrealizedPnlUsd;
}

export function AdminLiveTradeMonitor({
  initialRows,
}: {
  initialRows: AdminLivePositionRow[];
}) {
  const [rows, setRows] = useState<AdminLivePositionRow[]>(initialRows);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function pull() {
      try {
        const res = await fetch("/api/admin/active-positions", { cache: "no-store" });
        if (!res.ok) {
          setError(res.status === 401 ? "Unauthorized." : "Could not refresh.");
          return;
        }
        const data = (await res.json()) as {
          rows: AdminLivePositionRow[];
          updatedAt?: string;
        };
        if (!cancelled) {
          setRows(data.rows);
          setUpdatedAt(data.updatedAt ?? null);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Network error.");
      }
    }

    void pull();
    const id = setInterval(pull, 8000);
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

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No open legs across active runs right now.
        </p>
      ) : (
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
                <th className="px-3 py-2">Entry</th>
                <th className="px-3 py-2">Current</th>
                <th className="px-3 py-2">Live PnL</th>
                <th className="px-3 py-2 min-w-[200px]">Participating users</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-white/[0.05] bg-black/20">
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{row.strategyName}</td>
                  <td className="px-3 py-2">{row.symbol}</td>
                  <td className="px-3 py-2 text-sky-200/90">
                    {row.account === "D1" ? "D1" : "D2"}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-400">
                    {row.strategyPulse ? (
                      <StrategyPulseCell pulse={row.strategyPulse} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize text-slate-400">{row.mode}</td>
                  <td className="px-3 py-2 text-slate-300">{row.userLabel ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{row.side}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {row.avgEntryPrice != null ? row.avgEntryPrice.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {row.markPrice != null ? row.markPrice.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-medium text-emerald-100/90">
                    {formatUsdAmount(String(livePnlUsd(row)))}
                  </td>
                  <td className="px-3 py-2 text-[11px] leading-snug text-slate-400">
                    {row.participatingUsers}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
