"use client";

import { useCallback, useEffect, useState } from "react";

import type { UserDashboardData } from "@/lib/user-dashboard-types";

import { DashboardTradeTable } from "./DashboardTradeTable";
import { ExchangeStatusBadge } from "./ExchangeStatusBadge";
import { PnLMiniChart } from "./PnLMiniChart";
import { StatCard } from "./StatCard";

function formatInrAmount(s: string, opts?: { fractionDigits?: number }): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: opts?.fractionDigits ?? 2,
  }).format(n);
}

type TradeScope = "bot" | "all";

/**
 * Client shell: scope toggle + polling via `/api/user/dashboard` (upgrade to WebSocket later).
 */
export function UserDashboardClient({ initial }: { initial: UserDashboardData }) {
  const [data, setData] = useState(initial);
  const [scope, setScope] = useState<TradeScope>("bot");
  const [pollError, setPollError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/user/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as UserDashboardData;
      setData(json);
      setPollError(null);
    } catch {
      setPollError("Could not refresh dashboard (will retry).");
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 45_000);
    return () => clearInterval(t);
  }, [refresh]);

  const pnlAccent = (s: string) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n === 0) return "default" as const;
    return n > 0 ? ("positive" as const) : ("negative" as const);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Bot performance, strategy runs, exchange health, and revenue share — refreshed
            automatically about every 45s.
          </p>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Last update:{" "}
          <span className="text-[var(--text-primary)]">
            {new Date(data.asOf).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
              timeStyle: "short",
            })}{" "}
            IST
          </span>
        </p>
      </div>

      {pollError ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          {pollError}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Today's bot profit (IST)"
          value={formatInrAmount(data.todayBotPnlInr)}
          hint="Sum of realized PnL on filled bot orders for today in Asia/Kolkata."
          accent={pnlAccent(data.todayBotPnlInr)}
        />
        <StatCard
          label="Total bot PnL"
          value={formatInrAmount(data.totalBotPnlInr)}
          hint="All-time sum of realized PnL on bot-filled orders."
          accent={pnlAccent(data.totalBotPnlInr)}
        />
        <StatCard
          label="Revenue share due (this week)"
          value={formatInrAmount(data.revenueDueWeekInr)}
          hint="Unpaid balance for weekly ledgers covering today (IST calendar week rows)."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard
          label="Active strategies"
          value={data.runsActive}
          hint="Runs with status active."
        />
        <StatCard
          label="Paused / blocked"
          value={data.runsPaused}
          hint="Paused, revenue, exchange, admin, or user pauses."
        />
        <StatCard
          label="Inactive / other"
          value={data.runsInactive}
          hint="Inactive, ready to activate, expired, or other states."
        />
      </div>

      <div className="glass-panel rounded-2xl border border-[var(--border-glass)] p-5">
        <ExchangeStatusBadge exchange={data.exchange} />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Chart & activity
        </p>
        <div className="flex rounded-full border border-[var(--border-glass)] bg-black/25 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setScope("bot")}
            className={`rounded-full px-4 py-1.5 transition ${
              scope === "bot"
                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Bot trades only
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`rounded-full px-4 py-1.5 transition ${
              scope === "all"
                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            All transactions
          </button>
        </div>
      </div>

      <PnLMiniChart
        title={scope === "bot" ? "Daily bot PnL" : "Daily PnL (all trades)"}
        series={scope === "bot" ? data.chartBot : data.chartAll}
      />

      <DashboardTradeTable
        title={scope === "bot" ? "Latest bot orders" : "Latest transactions"}
        rows={scope === "bot" ? data.botTrades : data.allTrades}
        mode={scope}
      />
    </div>
  );
}
