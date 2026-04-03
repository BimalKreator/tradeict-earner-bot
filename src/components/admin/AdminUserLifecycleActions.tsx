"use client";

import { useActionState } from "react";

import {
  approveUserFormAction,
  archiveUserFormAction,
  pauseUserFormAction,
  rejectUserFormAction,
} from "@/server/actions/adminUsers";

type Status =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paused"
  | "archived";

export function AdminUserLifecycleActions({
  userId,
  status,
}: {
  userId: string;
  status: Status;
}) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveUserFormAction,
    null,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectUserFormAction,
    null,
  );
  const [pauseState, pauseAction, pausePending] = useActionState(
    pauseUserFormAction,
    null,
  );
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveUserFormAction,
    null,
  );

  const busy =
    approvePending ||
    rejectPending ||
    pausePending ||
    archivePending;

  return (
    <div className="flex flex-col gap-4">
      {status === "pending_approval" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <form action={approveAction}>
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Approve
            </button>
          </form>
          <form action={rejectAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="userId" value={userId} />
            <input
              name="note"
              placeholder="Optional note to user"
              className="min-w-[200px] rounded-xl border border-[var(--border-glass)] bg-black/20 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              Reject
            </button>
          </form>
        </div>
      ) : null}

      {status === "approved" || status === "pending_approval" ? (
        <form action={pauseAction}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
          >
            Pause user
          </button>
        </form>
      ) : null}

      {status === "paused" ? (
        <form action={approveAction}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Resume (set approved)
          </button>
        </form>
      ) : null}

      {status !== "archived" ? (
        <form action={archiveAction}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl border border-slate-500/50 bg-slate-500/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-500/20 disabled:opacity-50"
          >
            Archive user
          </button>
        </form>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          This user is archived. Restore flows can be added in a later phase.
        </p>
      )}

      {approveState && "error" in approveState ? (
        <p className="text-xs text-red-300">{approveState.error}</p>
      ) : null}
      {rejectState && "error" in rejectState ? (
        <p className="text-xs text-red-300">{rejectState.error}</p>
      ) : null}
      {pauseState && "error" in pauseState ? (
        <p className="text-xs text-red-300">{pauseState.error}</p>
      ) : null}
      {archiveState && "error" in archiveState ? (
        <p className="text-xs text-red-300">{archiveState.error}</p>
      ) : null}
    </div>
  );
}
