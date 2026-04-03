"use client";

import { useCallback, useEffect, useState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount } from "@/lib/format-inr";
import {
  type FundsLiveApiResponse,
  isFundsLiveOk,
} from "@/lib/funds-live-api";
import type { UserFundsPlatformSnapshot } from "@/server/queries/user-funds-platform";

function formatDeltaMovementTime(createdAt: string | null): string {
  if (!createdAt) return "—";
  const n = Number(createdAt);
  if (Number.isFinite(n)) {
    let ms = n;
    if (n > 1e18) ms = n / 1e6;
    else if (n > 1e15) ms = n / 1e3;
    else if (n < 1e11) ms = n * 1000;
    return new Date(ms).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  const t = Date.parse(createdAt);
  if (Number.isFinite(t)) {
    return new Date(t).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return "—";
}

function StatCard({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <GlassPanel className="!p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className={`mt-2 font-[family-name:var(--font-display)] text-xl font-bold tabular-nums sm:text-2xl ${valueClass ?? "text-[var(--text-primary)]"}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[10px] leading-snug text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </GlassPanel>
  );
}

/**
 * Polls `/api/user/funds/live` every 60s; merges with platform snapshot for the top grid.
 */
export function UserFundsPollingSection({
  platform,
  showExchangeTables,
}: {
  platform: UserFundsPlatformSnapshot;
  showExchangeTables: boolean;
}) {
  const [data, setData] = useState<FundsLiveApiResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/user/funds/live", { credentials: "include" });
      const json = (await res.json()) as FundsLiveApiResponse;
      setData(json);
    } catch {
      setData({
        ok: false,
        code: "network",
        message: "Could not reach wallet service.",
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const liveOk = data && isFundsLiveOk(data) ? data : null;
  const liveErr = data && !isFundsLiveOk(data) ? data : null;

  const bal =
    liveOk && liveOk.liveBalance != null
      ? formatInrAmount(liveOk.liveBalance)
      : liveOk?.balanceError
        ? "—"
        : liveErr
          ? "—"
          : "…";
  const margin =
    liveOk && liveOk.availableMargin != null
      ? formatInrAmount(liveOk.availableMargin)
      : liveOk?.balanceError
        ? "—"
        : liveErr
          ? "—"
          : "…";

  const netFlow =
    liveOk && liveOk.netFundFlow != null
      ? formatInrAmount(liveOk.netFundFlow)
      : "—";

  const netFlowHint =
    liveOk?.netExternalMovementHint != null
      ? `Uses latest ${liveOk.movements.length} Delta movements only (deposits − withdrawals heuristic). Not full account history.`
      : undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Live balance (Delta)"
          value={bal}
          hint={
            liveOk?.balanceError
              ? liveOk.balanceError
              : liveErr
                ? liveErr.message
                : "From meta.net_equity / wallet rows."
          }
        />
        <StatCard
          label="Available margin (sum)"
          value={margin}
          hint="Sum of per-asset available_balance from Delta."
        />
        <StatCard
          label="Pending revenue share (all)"
          value={formatInrAmount(platform.revenueSharePendingAllInr)}
          hint="Unpaid + partial on all weekly ledger rows."
        />
        <StatCard
          label="Total net profit (ledger)"
          value={formatInrAmount(platform.totalNetProfitInr)}
          hint="Sum of realized PnL on bot orders + trades."
          valueClass={
            Number(platform.totalNetProfitInr) >= 0
              ? "text-emerald-400"
              : "text-red-400"
          }
        />
      </div>

      <GlassPanel className="!p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Net fund flow (estimate)
        </p>
        <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-[var(--text-primary)]">
          {netFlow}
        </p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Formula: <span className="text-[var(--accent)]">live balance</span> −{" "}
          <span className="text-[var(--accent)]">net external flows</span> inferred
          from the movements sample. Use exchange reports for tax-grade history.
        </p>
        {netFlowHint ? (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">{netFlowHint}</p>
        ) : null}
        {liveOk?.transactionError ? (
          <p className="mt-2 text-xs text-amber-200/90">
            Movements: {liveOk.transactionError}
          </p>
        ) : null}
      </GlassPanel>

      {showExchangeTables && liveOk ? (
        <GlassPanel className="!p-0 overflow-hidden">
          <div className="border-b border-[var(--border-glass)] px-5 py-3">
            <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--text-primary)]">
              Exchange movements (latest 10)
            </h2>
            <p className="text-[10px] text-[var(--text-muted)]">
              Delta <code className="text-[var(--accent)]">GET /v2/wallet/transactions</code>{" "}
              — refreshed with balance poll.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-glass)] bg-black/25 text-xs uppercase text-[var(--text-muted)]">
                  <th className="px-4 py-2">Time</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {liveOk.movements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-[var(--text-muted)]"
                    >
                      No rows returned.
                    </td>
                  </tr>
                ) : (
                  liveOk.movements.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-[var(--border-glass)]/40 hover:bg-white/[0.03]"
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-[var(--text-muted)]">
                        {formatDeltaMovementTime(m.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-xs">{m.transactionType}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--accent)]">
                        {m.assetSymbol}
                      </td>
                      <td
                        className={`px-3 py-2 tabular-nums text-xs ${
                          Number(m.amount) >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {m.amount}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-xs text-[var(--text-muted)]">
                        {m.balanceAfter ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      ) : null}

      {showExchangeTables && liveErr ? (
        <GlassPanel className="!p-5">
          <p className="text-sm text-[var(--text-muted)]">{liveErr.message}</p>
        </GlassPanel>
      ) : null}
    </div>
  );
}
