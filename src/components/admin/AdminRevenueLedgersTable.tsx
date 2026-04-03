"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { formatInrAmount } from "@/lib/format-inr";
import {
  adminApplyFeeWaiverFormAction,
  adminSaveLedgerNotesFormAction,
  adminSendPaymentReminderFormAction,
  type AdminRevenueActionState,
} from "@/server/actions/adminRevenueActions";
import type { AdminRevenueLedgerRow } from "@/server/queries/admin-revenue";

const LEDGER_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  waived: "Waived",
};

function ActionMessage({ state }: { state: AdminRevenueActionState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p className="text-xs text-emerald-400/90" role="status">
        {state.message}
      </p>
    );
  }
  return (
    <p className="text-xs text-red-400/90" role="alert">
      {state.message}
    </p>
  );
}

function LedgerActionsModal({
  row,
  onClose,
}: {
  row: AdminRevenueLedgerRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [waiverState, waiverAction, waiverPending] = useActionState(
    adminApplyFeeWaiverFormAction,
    null,
  );
  const [remState, remAction, remPending] = useActionState(
    adminSendPaymentReminderFormAction,
    null,
  );
  const [noteState, noteAction, notePending] = useActionState(
    adminSaveLedgerNotesFormAction,
    null,
  );

  useEffect(() => {
    if (waiverState?.ok || remState?.ok || noteState?.ok) {
      router.refresh();
    }
  }, [waiverState, remState, noteState, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ledger-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border-glass)] bg-[#0a0c12] p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="ledger-modal-title"
              className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--text-primary)]"
            >
              Ledger actions
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {row.userEmail} · {row.strategyName} · {row.weekStartDateIst} →{" "}
              {row.weekEndDateIst}
            </p>
            <p className="mt-1 text-xs tabular-nums text-[var(--text-primary)]">
              Due {formatInrAmount(row.amountDueInr)} · Paid{" "}
              {formatInrAmount(row.amountPaidInr)} · Out{" "}
              <span className="font-semibold text-amber-300/90">
                {formatInrAmount(row.outstandingInr)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-5 border-t border-[var(--border-glass)] pt-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Fee waiver
            </h3>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Reduces <code className="text-[var(--text-primary)]">amount_due_inr</code>{" "}
              (capped at outstanding). Logged to fee_waivers + audit_logs.
            </p>
            <form action={waiverAction} className="mt-2 space-y-2">
              <input type="hidden" name="ledgerId" value={row.id} />
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-[var(--text-muted)]">
                  Amount (INR)
                  <input
                    name="amountInr"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 500"
                    className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  />
                </label>
                <label className="text-xs text-[var(--text-muted)]">
                  Or percent of outstanding
                  <input
                    name="percent"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 25"
                    className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  />
                </label>
              </div>
              <label className="block text-xs text-[var(--text-muted)]">
                Reason (required)
                <textarea
                  name="reason"
                  required
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)]"
                />
              </label>
              <button
                type="submit"
                disabled={waiverPending}
                className="rounded-lg bg-violet-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {waiverPending ? "Applying…" : "Apply waiver"}
              </button>
              <ActionMessage state={waiverState} />
            </form>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Payment reminder
            </h3>
            <form action={remAction} className="mt-2 space-y-2">
              <input type="hidden" name="ledgerId" value={row.id} />
              <button
                type="submit"
                disabled={remPending}
                className="rounded-lg bg-sky-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {remPending ? "Sending…" : "Send email reminder"}
              </button>
              <ActionMessage state={remState} />
            </form>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Internal notes
            </h3>
            <form action={noteAction} className="mt-2 space-y-2">
              <input type="hidden" name="ledgerId" value={row.id} />
              <textarea
                name="adminNotes"
                rows={3}
                defaultValue={row.adminNotes ?? ""}
                placeholder="Visible to admins only"
                className="w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)]"
              />
              <button
                type="submit"
                disabled={notePending}
                className="rounded-lg border border-[var(--border-glass)] bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-50"
              >
                {notePending ? "Saving…" : "Save notes"}
              </button>
              <ActionMessage state={noteState} />
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

export function AdminRevenueLedgersTable({ rows }: { rows: AdminRevenueLedgerRow[] }) {
  const [open, setOpen] = useState<AdminRevenueLedgerRow | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No ledger rows match these filters.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)] sm:text-xs">
              <th className="pb-2 pr-3 font-medium">Week (IST)</th>
              <th className="pb-2 pr-3 font-medium">User</th>
              <th className="pb-2 pr-3 font-medium">Strategy</th>
              <th className="pb-2 pr-3 font-medium">Due</th>
              <th className="pb-2 pr-3 font-medium">Paid</th>
              <th className="pb-2 pr-3 font-medium">Out</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Billing</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
              >
                <td className="py-2 pr-3 align-top text-[var(--text-muted)]">
                  {r.weekStartDateIst} → {r.weekEndDateIst}
                </td>
                <td className="py-2 pr-3 align-top">
                  <Link
                    href={`/admin/revenue/users/${r.userId}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {r.userEmail}
                  </Link>
                </td>
                <td className="max-w-[140px] py-2 pr-3 align-top text-[var(--text-muted)]">
                  <span className="line-clamp-2">{r.strategyName}</span>
                </td>
                <td className="py-2 pr-3 align-top tabular-nums">
                  {formatInrAmount(r.amountDueInr)}
                </td>
                <td className="py-2 pr-3 align-top tabular-nums text-[var(--text-muted)]">
                  {formatInrAmount(r.amountPaidInr)}
                </td>
                <td className="py-2 pr-3 align-top tabular-nums font-medium text-amber-300/80">
                  {formatInrAmount(r.outstandingInr)}
                </td>
                <td className="py-2 pr-3 align-top">
                  <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] sm:text-xs">
                    {LEDGER_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
                <td className="py-2 pr-3 align-top">
                  {r.userBlockedRevenue ? (
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200 sm:text-xs">
                      Blocked
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--text-muted)] sm:text-xs">
                      Clean
                    </span>
                  )}
                </td>
                <td className="py-2 align-top">
                  <button
                    type="button"
                    onClick={() => setOpen(r)}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <LedgerActionsModal row={open} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
