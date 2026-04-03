"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  approveUserFormAction,
  rejectUserFormAction,
} from "@/server/actions/adminUsers";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  approvalStatus: string;
  createdAt: Date;
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived",
};

type Props = { rows: AdminUserRow[] };

export function AdminUsersTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No users match this filter.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-3 pr-4 font-medium">Email</th>
            <th className="pb-3 pr-4 font-medium">Name</th>
            <th className="pb-3 pr-4 font-medium">Phone</th>
            <th className="pb-3 pr-4 font-medium">Status</th>
            <th className="pb-3 pr-4 font-medium">Registered</th>
            <th className="pb-3 pr-4 font-medium">Profile</th>
            <th className="pb-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <AdminUserRow key={r.id} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminUserRow({ row }: { row: AdminUserRow }) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveUserFormAction,
    null,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectUserFormAction,
    null,
  );

  const dateStr = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(row.createdAt));

  const statusLabel =
    STATUS_LABELS[row.approvalStatus] ?? row.approvalStatus;
  const showActions = row.approvalStatus === "pending_approval";

  return (
    <tr className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]">
      <td className="py-3 pr-4 align-top">{row.email}</td>
      <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
        {row.name ?? "—"}
      </td>
      <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
        {row.phone ?? "—"}
      </td>
      <td className="py-3 pr-4 align-top">
        <span className="rounded-lg bg-white/5 px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {statusLabel}
        </span>
      </td>
      <td className="py-3 pr-4 align-top text-[var(--text-muted)]">{dateStr}</td>
      <td className="py-3 pr-4 align-top">
        <Link
          href={`/admin/users/${row.id}`}
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          View
        </Link>
      </td>
      <td className="py-3 align-top">
        {showActions ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <form action={approveAction}>
                <input type="hidden" name="userId" value={row.id} />
                <button
                  type="submit"
                  disabled={approvePending || rejectPending}
                  className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Approve
                </button>
              </form>
              <form action={rejectAction} className="flex flex-col gap-1">
                <input type="hidden" name="userId" value={row.id} />
                <input
                  name="note"
                  placeholder="Optional note to user"
                  className="w-full min-w-[180px] rounded-lg border border-[var(--border-glass)] bg-black/20 px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  disabled={approvePending || rejectPending}
                  className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                >
                  Reject
                </button>
              </form>
            </div>
            {approveState && "error" in approveState ? (
              <p className="mt-1 text-xs text-red-300">{approveState.error}</p>
            ) : null}
            {rejectState && "error" in rejectState ? (
              <p className="mt-1 text-xs text-red-300">{rejectState.error}</p>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">—</span>
        )}
      </td>
    </tr>
  );
}
