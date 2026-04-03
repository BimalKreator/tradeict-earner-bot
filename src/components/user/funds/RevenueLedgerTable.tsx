"use client";

import { useCallback, useState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount } from "@/lib/format-inr";
import { payRevenueShareAction } from "@/server/actions/revenueShareCheckout";
import type { RevenueLedgerRow } from "@/server/queries/user-funds-platform";

function loadCashfreeScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as unknown as { Cashfree?: unknown };
  if (w.Cashfree) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Could not load Cashfree SDK"));
    document.body.appendChild(el);
  });
}

type CashfreeFactory = (opts: { mode: string }) => {
  checkout: (o: {
    paymentSessionId: string;
    redirectTarget?: "_self" | "_modal" | "_top";
  }) => void;
};

function LedgerStatusBadge({
  ledger,
}: {
  ledger: RevenueLedgerRow;
}) {
  const lp = ledger.latestPaymentStatus ?? "";
  if (lp === "created" || lp === "pending") {
    return (
      <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
        Pending
      </span>
    );
  }
  if (
    (lp === "failed" || lp === "expired") &&
    ledger.status !== "paid" &&
    ledger.status !== "waived"
  ) {
    return (
      <span className="rounded-md bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
        Failed
      </span>
    );
  }
  if (ledger.status === "paid") {
    return (
      <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
        Paid
      </span>
    );
  }
  if (ledger.status === "partial") {
    return (
      <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
        Partial
      </span>
    );
  }
  if (ledger.status === "waived") {
    return (
      <span className="rounded-md bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
        Waived
      </span>
    );
  }
  return (
    <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
      Unpaid
    </span>
  );
}

export function RevenueLedgerTable({ ledgers }: { ledgers: RevenueLedgerRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = ledgers.find((l) => l.id === openId) ?? null;

  const startPay = useCallback(async (ledgerId: string) => {
    setError(null);
    setBusy(true);
    try {
      const result = await payRevenueShareAction(ledgerId);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      await loadCashfreeScript();
      const mode =
        result.cashfreeMode === "production" ? "PRODUCTION" : "SANDBOX";
      const cf = (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
      if (!cf) {
        setError("Cashfree SDK did not initialize.");
        setBusy(false);
        return;
      }
      const inst = cf({ mode });
      inst.checkout({
        paymentSessionId: result.paymentSessionId,
        redirectTarget: "_self",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const canPay = (r: RevenueLedgerRow) => {
    const st = r.latestPaymentStatus ?? "";
    if (st === "created" || st === "pending") return false;
    if (r.status === "paid" || r.status === "waived") return false;
    return Number(r.outstandingInr) >= 0.01;
  };

  return (
    <>
      <GlassPanel className="!p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
          Weekly revenue ledgers
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Pay outstanding weeks via Cashfree. Exit trades still run while entries
          are blocked for overdue share.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-glass)] text-xs uppercase text-[var(--text-muted)]">
                <th className="py-2 pr-3">Week (IST)</th>
                <th className="py-2 pr-3">Strategy</th>
                <th className="py-2 pr-3">Due</th>
                <th className="py-2 pr-3">Paid</th>
                <th className="py-2 pr-3">Outstanding</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Due at (IST)</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {ledgers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-[var(--text-muted)]">
                    No ledger rows yet.
                  </td>
                </tr>
              ) : (
                ledgers.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--border-glass)]/40"
                  >
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--accent)]">
                      {r.weekStart} → {r.weekEnd}
                    </td>
                    <td className="max-w-[140px] truncate py-2 pr-3 text-xs">
                      {r.strategyName}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {formatInrAmount(r.amountDueInr)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-emerald-400/90">
                      {formatInrAmount(r.amountPaidInr)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-amber-200/90">
                      {formatInrAmount(r.outstandingInr)}
                    </td>
                    <td className="py-2 pr-3">
                      <LedgerStatusBadge ledger={r} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">
                      {new Date(r.dueAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-0 text-right">
                      {canPay(r) ? (
                        <button
                          type="button"
                          onClick={() => setOpenId(r.id)}
                          className="rounded-lg bg-[var(--accent)]/90 px-3 py-1.5 text-xs font-semibold text-slate-950"
                        >
                          Pay
                        </button>
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rev-pay-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border-glass)] bg-slate-950/95 p-6 shadow-2xl">
            <h3
              id="rev-pay-title"
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]"
            >
              Pay revenue share
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {open.strategyName} · {open.weekStart} → {open.weekEnd} IST
            </p>

            <dl className="mt-4 space-y-2 rounded-xl border border-white/[0.08] bg-black/30 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Week period</dt>
                <dd className="font-mono text-xs text-[var(--text-primary)]">
                  {open.weekStart} → {open.weekEnd}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Weekly net profit</dt>
                <dd className="tabular-nums text-[var(--text-primary)]">
                  {open.weeklyNetProfitInr != null
                    ? formatInrAmount(open.weeklyNetProfitInr)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Share % (locked)</dt>
                <dd className="tabular-nums text-[var(--text-primary)]">
                  {open.revenueSharePercentApplied}%
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Amount due (ledger)</dt>
                <dd className="tabular-nums text-[var(--text-primary)]">
                  {formatInrAmount(open.amountDueInr)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Already paid</dt>
                <dd className="tabular-nums text-emerald-300/90">
                  {formatInrAmount(open.amountPaidInr)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-[var(--border-glass)]/50 pt-2">
                <dt className="font-medium text-amber-100">You pay now</dt>
                <dd className="text-lg font-bold tabular-nums text-amber-200">
                  {formatInrAmount(open.outstandingInr)}
                </dd>
              </div>
              <div className="pt-2">
                <dt className="text-[var(--text-muted)]">Waivers / notes</dt>
                <dd className="mt-1 text-xs leading-snug text-[var(--text-primary)]">
                  {open.waiverSummary}
                </dd>
              </div>
            </dl>

            {error ? (
              <p
                className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpenId(null);
                  setError(null);
                }}
                className="rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm font-medium text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => startPay(open.id)}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {busy ? "Starting…" : "Pay with Cashfree"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
