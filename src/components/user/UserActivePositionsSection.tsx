"use client";

import { useEffect, useState } from "react";

import { formatUsdAmount } from "@/lib/format-inr";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { UserActivePositionGroup } from "@/server/queries/active-positions-dashboard";

function livePnlUsd(leg: {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
}): number {
  return leg.realizedPnlUsd + leg.unrealizedPnlUsd;
}

export function UserActivePositionsSection({
  initialGroups,
}: {
  initialGroups: UserActivePositionGroup[];
}) {
  const [groups, setGroups] = useState<UserActivePositionGroup[]>(initialGroups);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function pull() {
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
        if (!cancelled) {
          setGroups(data.groups);
          setUpdatedAt(data.updatedAt ?? null);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Network error while refreshing.");
      }
    }

    void pull();
    const id = setInterval(pull, 8000);
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
          {groups.map((g) => (
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
                  <p className="text-[10px] uppercase tracking-wide text-emerald-200/70">Combined live PnL</p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-100">
                    {formatUsdAmount(String(g.combinedPnlUsd))}
                  </p>
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
                    </tr>
                  </thead>
                  <tbody>
                    {g.legs.map((leg) => (
                      <tr key={leg.key} className="border-t border-white/[0.06] bg-black/25">
                        <td className="px-4 py-3 font-semibold text-sky-200">
                          {leg.account === "D1" ? "Delta 1" : "Delta 2"}
                        </td>
                        <td className="px-4 py-3 font-medium">{leg.symbol}</td>
                        <td className="px-4 py-3 capitalize">{leg.side}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-300">{leg.netQty.toFixed(6)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-300">
                          {leg.avgEntryPrice != null ? leg.avgEntryPrice.toFixed(2) : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-white">
                          {leg.markPrice != null ? leg.markPrice.toFixed(2) : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-lg font-semibold text-emerald-100">
                          {formatUsdAmount(String(livePnlUsd(leg)))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
