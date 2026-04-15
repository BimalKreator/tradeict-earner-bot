"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { UserDashboardData } from "@/lib/user-dashboard-types";
import { formatInrAmount, formatUsdAmount } from "@/lib/format-inr";

import { DashboardTradeTable } from "./DashboardTradeTable";
import { ExchangeStatusBadge } from "./ExchangeStatusBadge";
import { FundsSummaryWidget } from "./FundsSummaryWidget";
import { PnLMiniChart } from "./PnLMiniChart";
import { StatCard } from "./StatCard";

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

      {data.botEntriesPausedRevenueShare ? (
        <div className="rounded-2xl border border-red-500/35 bg-gradient-to-r from-red-950/50 to-amber-950/30 px-4 py-3 text-sm text-red-100/95 shadow-[0_0_24px_-8px_rgba(239,68,68,0.45)] backdrop-blur-sm">
          <p className="font-semibold text-amber-100">
            Action required: bot entries are paused due to pending revenue share.
          </p>
          <p className="mt-1 text-xs text-red-100/75">
            Exit signals can still close open positions. Pay your weekly revenue
            balance to resume new entries.
          </p>
          <Link
            href="/user/funds"
            className="mt-2 inline-block text-xs font-semibold text-[var(--accent)] hover:underline"
          >
            Open funds & billing →
          </Link>
        </div>
      ) : null}

      <FundsSummaryWidget revenueDueWeekInr={data.revenueDueWeekInr} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Today's bot profit (IST, USD)"
          value={formatUsdAmount(data.todayBotPnlInr)}
          hint="Sum of realized PnL on filled bot orders for today in Asia/Kolkata (shown as USD)."
          accent={pnlAccent(data.todayBotPnlInr)}
        />
        <StatCard
          label="Total bot PnL (USD)"
          value={formatUsdAmount(data.totalBotPnlInr)}
          hint="All-time sum of realized PnL on bot-filled orders (shown as USD)."
          accent={pnlAccent(data.totalBotPnlInr)}
        />
        <StatCard
          label="Revenue share due (this week, INR)"
          value={formatInrAmount(data.revenueDueWeekInr)}
          hint="Unpaid platform revenue share for weekly ledgers covering today (IST)."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <div className="flex w-full max-w-md rounded-full border border-[var(--border-glass)] bg-black/25 p-1 text-xs font-semibold sm:w-auto">
          <button
            type="button"
            onClick={() => setScope("bot")}
            className={`min-h-11 flex-1 rounded-full px-3 py-2 transition sm:flex-none sm:px-4 ${
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
            className={`min-h-11 flex-1 rounded-full px-3 py-2 transition sm:flex-none sm:px-4 ${
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
        title={scope === "bot" ? "Daily bot PnL (USD)" : "Daily PnL — all trades (USD)"}
        series={scope === "bot" ? data.chartBot : data.chartAll}
      />

      {scope === "bot" && data.botPnlByExchangeAccount.length > 0 ? (
        <div className="rounded-2xl border border-[var(--border-glass)] bg-black/20 p-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Bot PnL by Delta profile
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Aggregated realized PnL from bot orders, split by the API account that executed
            each fill.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.botPnlByExchangeAccount.map((r) => (
              <li
                key={r.connectionId}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2 text-sm"
              >
                <span className="text-[var(--text-muted)]">{r.accountLabel}</span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatUsdAmount(r.pnlInr)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DashboardTradeTable
        title={scope === "bot" ? "Latest bot orders" : "Latest transactions"}
        rows={scope === "bot" ? data.botTrades : data.allTrades}
        mode={scope}
      />
    </div>
  );
}
