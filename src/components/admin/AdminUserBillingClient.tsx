"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { formatInrAmount } from "@/lib/format-inr";
import {
  adminSaveLedgerNotesFormAction,
  adminSavePaymentNotesFormAction,
  type AdminRevenueActionState,
} from "@/server/actions/adminRevenueActions";
import type {
  AdminUserBillingLedgerRow,
  AdminUserBillingPaymentRow,
  AdminUserBillingSubscriptionRow,
} from "@/server/queries/admin-revenue";

function Msg({ state }: { state: AdminRevenueActionState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-xs text-emerald-400/90">{state.message}</p>
  ) : (
    <p className="text-xs text-red-400/90">{state.message}</p>
  );
}

function LedgerNotesModal({
  row,
  onClose,
}: {
  row: AdminUserBillingLedgerRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    adminSaveLedgerNotesFormAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-glass)] bg-[#0a0c12] p-5">
        <div className="flex justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Ledger notes
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {row.strategyName} · {row.weekStart} → {row.weekEnd}
        </p>
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="ledgerId" value={row.id} />
          <textarea
            name="adminNotes"
            rows={4}
            defaultValue={row.adminNotes ?? ""}
            className="w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)]"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <Msg state={state} />
        </form>
      </div>
    </div>
  );
}

function PaymentNotesModal({
  row,
  onClose,
}: {
  row: AdminUserBillingPaymentRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    adminSavePaymentNotesFormAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-glass)] bg-[#0a0c12] p-5">
        <div className="flex justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Payment notes
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {row.kind} · {row.status} · {formatInrAmount(row.amountInr)}
        </p>
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="paymentId" value={row.id} />
          <textarea
            name="adminNotes"
            rows={4}
            defaultValue={row.adminNotes ?? ""}
            className="w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)]"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <Msg state={state} />
        </form>
      </div>
    </div>
  );
}

type BillingData = {
  email: string;
  name: string | null;
  blockedRevenue: boolean;
  subscriptions: AdminUserBillingSubscriptionRow[];
  ledgers: AdminUserBillingLedgerRow[];
  payments: AdminUserBillingPaymentRow[];
};

export function AdminUserBillingClient({
  userId,
  data,
}: {
  userId: string;
  data: BillingData;
}) {
  const [ledgerNote, setLedgerNote] = useState<AdminUserBillingLedgerRow | null>(
    null,
  );
  const [payNote, setPayNote] = useState<AdminUserBillingPaymentRow | null>(
    null,
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/revenue"
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          ← Revenue dashboard
        </Link>
        <Link
          href={`/admin/users/${userId}`}
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          Admin user profile
        </Link>
        {data.blockedRevenue ? (
          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">
            Blocked for revenue due
          </span>
        ) : (
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200/90">
            Clean billing (runs)
          </span>
        )}
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Subscriptions
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)] sm:text-xs">
                <th className="pb-2 pr-3 font-medium">Strategy</th>
                <th className="pb-2 pr-3 font-medium">Sub status</th>
                <th className="pb-2 pr-3 font-medium">Run status</th>
                <th className="pb-2 font-medium">Access until</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptions.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-3 text-[var(--text-muted)]"
                  >
                    No subscriptions.
                  </td>
                </tr>
              ) : (
                data.subscriptions.map((s) => (
                  <tr
                    key={s.subscriptionId}
                    className="border-b border-[var(--border-glass)]/60"
                  >
                    <td className="py-2 pr-3">{s.strategyName}</td>
                    <td className="py-2 pr-3 text-[var(--text-muted)]">
                      {s.status}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-muted)]">
                      {s.runStatus}
                    </td>
                    <td className="py-2 text-[var(--text-muted)]">
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeZone: "Asia/Kolkata",
                      }).format(new Date(s.accessValidUntil))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Weekly revenue ledgers
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)] sm:text-xs">
                <th className="pb-2 pr-3 font-medium">Week</th>
                <th className="pb-2 pr-3 font-medium">Strategy</th>
                <th className="pb-2 pr-3 font-medium">Due</th>
                <th className="pb-2 pr-3 font-medium">Paid</th>
                <th className="pb-2 pr-3 font-medium">Out</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.ledgers.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border-glass)]/60"
                >
                  <td className="py-2 pr-3 text-[var(--text-muted)]">
                    {r.weekStart} → {r.weekEnd}
                  </td>
                  <td className="py-2 pr-3">{r.strategyName}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatInrAmount(r.amountDueInr)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-[var(--text-muted)]">
                    {formatInrAmount(r.amountPaidInr)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-amber-300/80">
                    {formatInrAmount(r.outstandingInr)}
                  </td>
                  <td className="py-2 pr-3 text-[var(--text-muted)]">{r.status}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => setLedgerNote(r)}
                      className="text-xs font-semibold text-[var(--accent)] hover:underline"
                    >
                      {r.adminNotes ? "Edit notes" : "Add notes"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Payment attempts
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)] sm:text-xs">
                <th className="pb-2 pr-3 font-medium">When (UTC)</th>
                <th className="pb-2 pr-3 font-medium">Kind</th>
                <th className="pb-2 pr-3 font-medium">Amount</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium">Strategy</th>
                <th className="pb-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-[var(--border-glass)]/60"
                >
                  <td className="py-2 pr-3 text-[var(--text-muted)]">
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "UTC",
                    }).format(new Date(p.createdAt))}
                  </td>
                  <td className="py-2 pr-3">{p.kind}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatInrAmount(p.amountInr)}
                  </td>
                  <td className="py-2 pr-3">{p.status}</td>
                  <td className="py-2 pr-3 text-[var(--text-muted)]">
                    {p.strategyName ?? "—"}
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => setPayNote(p)}
                      className="text-xs font-semibold text-[var(--accent)] hover:underline"
                    >
                      {p.adminNotes ? "Edit notes" : "Add notes"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {ledgerNote ? (
        <LedgerNotesModal
          key={ledgerNote.id}
          row={ledgerNote}
          onClose={() => setLedgerNote(null)}
        />
      ) : null}
      {payNote ? (
        <PaymentNotesModal
          key={payNote.id}
          row={payNote}
          onClose={() => setPayNote(null)}
        />
      ) : null}
    </div>
  );
}
