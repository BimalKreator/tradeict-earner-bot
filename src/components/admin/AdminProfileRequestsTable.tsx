"use client";

import { useActionState } from "react";

import {
  PROFILE_FIELD_LABELS,
  type ProfileChangeFieldKey,
  type ProfileChangesJson,
} from "@/lib/profile-change-fields";
import {
  type AdminProfileRequestActionState,
  approveProfileChangeRequestFormAction,
  rejectProfileChangeRequestFormAction,
} from "@/server/actions/adminProfileRequests";

type Row = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  changesJson: unknown;
  createdAt: Date;
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-100",
  approved: "bg-emerald-500/15 text-emerald-100",
  rejected: "bg-red-500/15 text-red-100",
};

function ChangeDiff({ changes }: { changes: ProfileChangesJson }) {
  const keys = Object.keys(changes) as ProfileChangeFieldKey[];
  return (
    <ul className="space-y-2 text-xs text-[var(--text-muted)]">
      {keys.map((k) => {
        const label = PROFILE_FIELD_LABELS[k] ?? k;
        const c = changes[k];
        if (!c) return null;
        return (
          <li
            key={k}
            className="rounded-lg border border-[var(--border-glass)] bg-black/20 p-2"
          >
            <span className="font-medium text-[var(--text-primary)]">
              {label}
            </span>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              <div>
                <span className="text-[10px] uppercase text-slate-500">
                  Old
                </span>
                <p className="break-all text-[var(--text-muted)]">
                  {c.old ?? "—"}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500">
                  New
                </span>
                <p className="break-all text-[var(--accent)]">{c.new ?? "—"}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RequestCard({ row }: { row: Row }) {
  const changes = row.changesJson as ProfileChangesJson;
  const [approveState, approveAction, approvePending] = useActionState(
    approveProfileChangeRequestFormAction,
    null as AdminProfileRequestActionState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectProfileChangeRequestFormAction,
    null as AdminProfileRequestActionState,
  );

  const busy = approvePending || rejectPending;
  const fmt = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  return (
    <article className="rounded-2xl border border-[var(--border-glass)] bg-[rgba(3,7,18,0.55)] p-4 backdrop-blur-md sm:p-5">
      <div className="flex flex-col gap-2 border-b border-[var(--border-glass)]/60 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium text-[var(--text-primary)]">
            {row.userName ?? "—"}{" "}
            <span className="text-sm font-normal text-[var(--text-muted)]">
              ({row.userEmail})
            </span>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Requested {fmt.format(new Date(row.createdAt))} (IST)
          </p>
        </div>
        <span
          className={`w-fit rounded-lg px-2 py-0.5 text-xs font-medium ${STATUS_BADGE.pending}`}
        >
          Pending
        </span>
      </div>
      <div className="mt-4">
        <ChangeDiff changes={changes} />
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <form action={approveAction}>
          <input type="hidden" name="requestId" value={row.id} />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-emerald-600/90 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 sm:w-auto"
          >
            Approve
          </button>
        </form>
        <form action={rejectAction} className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md">
          <input type="hidden" name="requestId" value={row.id} />
          <input
            name="note"
            placeholder="Optional note to user (rejection)"
            className="w-full rounded-xl border border-[var(--border-glass)] bg-black/20 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
          >
            Reject
          </button>
        </form>
      </div>
      {approveState && "error" in approveState ? (
        <p className="mt-2 text-xs text-red-300">{approveState.error}</p>
      ) : null}
      {rejectState && "error" in rejectState ? (
        <p className="mt-2 text-xs text-red-300">{rejectState.error}</p>
      ) : null}
    </article>
  );
}

export function AdminProfileRequestsTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No pending profile change requests.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {rows.map((r) => (
        <RequestCard key={r.id} row={r} />
      ))}
    </div>
  );
}
