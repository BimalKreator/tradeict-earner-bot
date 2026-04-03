"use client";

import { useActionState } from "react";

import { adminBulkPaymentReminderFormAction } from "@/server/actions/adminRevenueActions";

export function AdminRevenueBulkReminders() {
  const [state, action, pending] = useActionState(
    adminBulkPaymentReminderFormAction,
    null,
  );

  return (
    <div className="mt-6 rounded-xl border border-[var(--border-glass)] bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        Bulk payment reminders
      </h3>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Paste up to 25 weekly ledger UUIDs (space, comma, or newline separated).
        Each eligible row sends one email and creates an audit entry.
      </p>
      <form action={action} className="mt-3 space-y-2">
        <textarea
          name="ledgerIds"
          rows={3}
          placeholder="uuid …"
          className="w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send bulk reminders"}
        </button>
      </form>
      {state?.ok === true ? (
        <p className="mt-2 text-xs text-emerald-400/90">{state.message}</p>
      ) : null}
      {state?.ok === false ? (
        <p className="mt-2 text-xs text-red-400/90">{state.message}</p>
      ) : null}
    </div>
  );
}
