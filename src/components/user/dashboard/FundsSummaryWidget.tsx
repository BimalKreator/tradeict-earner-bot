"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatInrAmount, formatUsdAmount } from "@/lib/format-inr";
import { isFundsLiveOk, type FundsLiveApiResponse } from "@/lib/funds-live-api";

/**
 * Polls `/api/user/funds/live` every 60s for aggregated Delta balances; shows weekly revenue due from SSR props.
 */
export function FundsSummaryWidget({
  revenueDueWeekInr,
}: {
  revenueDueWeekInr: string;
}) {
  const [live, setLive] = useState<FundsLiveApiResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/user/funds/live", { credentials: "include" });
      setLive((await res.json()) as FundsLiveApiResponse);
    } catch {
      setLive({
        ok: false,
        code: "network",
        message: "Could not load wallet snapshot.",
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const ok = live && isFundsLiveOk(live) ? live : null;
  const bal =
    ok?.liveBalance != null
      ? formatUsdAmount(ok.liveBalance)
      : ok?.balanceError
        ? "—"
        : live && !isFundsLiveOk(live)
          ? "—"
          : "…";

  return (
    <div className="glass-panel rounded-2xl border border-[var(--border-glass)]/80 bg-gradient-to-br from-black/35 to-slate-950/40 p-5 backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Funds snapshot
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Total live Delta balance across linked profiles (e.g. D1 + D2) in USD (60s
            refresh) and revenue share due this IST week (INR).
          </p>
        </div>
        <Link
          href="/user/funds"
          className="shrink-0 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20"
        >
          Open funds →
        </Link>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase text-[var(--text-muted)]">
            Total live balance (USD)
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-display)] text-xl font-bold tabular-nums text-[var(--text-primary)]">
            {bal}
          </p>
          {ok?.balanceError ? (
            <p className="mt-1 text-[10px] text-amber-200/80">{ok.balanceError}</p>
          ) : null}
          {live && !isFundsLiveOk(live) ? (
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {live.message}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-[10px] uppercase text-[var(--text-muted)]">
            Revenue due (this week, INR)
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-display)] text-xl font-bold tabular-nums text-amber-200/90">
            {formatInrAmount(revenueDueWeekInr)}
          </p>
        </div>
      </div>
    </div>
  );
}
