"use client";

import { useEffect, useState } from "react";

import { formatUsdAmount } from "@/lib/format-inr";
import type {
  AdminLivePositionRow,
  AdminStrategyStatusRow,
} from "@/server/queries/active-positions-dashboard";

function StrategyPulseCell({ pulse }: { pulse: NonNullable<AdminLivePositionRow["strategyPulse"]> }) {
  const h = pulse.history;
  const historyReady = pulse.barsReady === "OK" && h.closedBars >= h.targetBars;
  const signalOk = pulse.barsReady === "OK";
  const priceOk = pulse.barsReady === "OK";

  let d1EntryLabel: string;
  let d1EntryOk: boolean;
  if (pulse.d1Status === "Active") {
    d1EntryLabel = "Active";
    d1EntryOk = true;
  } else if (pulse.hasEntrySignalBar) {
    d1EntryLabel = "Pending";
    d1EntryOk = false;
  } else {
    d1EntryLabel = "Crossover Wait";
    d1EntryOk = false;
  }

  const historyLine = historyReady ? (
    <span className="text-emerald-400/95">
      <span className="mr-1">✅</span>
      Bars:{" "}
      <span className="font-semibold tabular-nums">
        {h.closedBars >= h.targetBars ? `${h.closedBars}+` : `${h.closedBars}`} OK
      </span>
      <span className="text-emerald-500/80"> (target {h.targetBars} closed)</span>
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
      <li className={signalOk ? "text-emerald-400/95" : "text-amber-300/95"}>
        <span className="mr-1">{signalOk ? "✅" : "⏳"}</span>
        Signal:{" "}
        <span className="font-semibold tabular-nums text-slate-100">[{pulse.trendDirection}]</span>
      </li>
      <li className={priceOk ? "text-emerald-400/95" : "text-amber-300/95"}>
        <span className="mr-1">{priceOk ? "✅" : "⏳"}</span>
        Price vs HT:{" "}
        <span className="font-semibold tabular-nums text-slate-100">[{pulse.priceVsHt}]</span>
      </li>
      <li className={d1EntryOk ? "text-emerald-400/95" : "text-amber-300/95"}>
        <span className="mr-1">{d1EntryOk ? "✅" : "⏳"}</span>
        D1 Entry:{" "}
        <span className="font-semibold text-slate-100">[{d1EntryLabel}]</span>
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
  initialStatusRows,
}: {
  initialRows: AdminLivePositionRow[];
  initialStatusRows: AdminStrategyStatusRow[];
}) {
  const [rows, setRows] = useState<AdminLivePositionRow[]>(initialRows);
  const [statusRows, setStatusRows] = useState<AdminStrategyStatusRow[]>(initialStatusRows);
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
          statusRows?: AdminStrategyStatusRow[];
          updatedAt?: string;
        };
        if (!cancelled) {
          setRows(data.rows);
          setStatusRows(data.statusRows ?? []);
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
      ) : statusRows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">
            No open legs right now — showing strategy pulse for active subscriptions.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="min-w-[900px] w-full text-left text-xs text-slate-200">
              <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Trader</th>
                  <th className="px-3 py-2 min-w-[180px]">Strategy status</th>
                  <th className="px-3 py-2 min-w-[220px]">Participating users</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.key} className="border-t border-white/[0.05] bg-black/20">
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                      {row.strategyName}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-400">{row.mode}</td>
                    <td className="px-3 py-2 text-slate-300">{row.userLabel}</td>
                    <td className="px-3 py-2 align-top text-slate-400">
                      <StrategyPulseCell pulse={row.strategyPulse} />
                    </td>
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
