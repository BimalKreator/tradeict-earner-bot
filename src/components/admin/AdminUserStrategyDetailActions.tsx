"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { adminCanForcePauseRunStatus } from "@/lib/admin-strategy-run";
import {
  adminExtendSubscriptionFormAction,
  adminForcePauseRunFormAction,
  adminResumeRunFormAction,
} from "@/server/actions/adminUserStrategyControls";

import { GlassPanel } from "@/components/ui/GlassPanel";

export function AdminUserStrategyDetailActions(props: {
  subscriptionId: string;
  runId: string;
  runStatus: string;
  userId: string;
}) {
  const { subscriptionId, runId, runStatus, userId } = props;

  const pauseNoteId = useId();
  const resumeNoteId = useId();

  const [pauseState, pauseAction, pausePending] = useActionState(
    adminForcePauseRunFormAction,
    null,
  );
  const [resumeState, resumeAction, resumePending] = useActionState(
    adminResumeRunFormAction,
    null,
  );
  const [extendState, extendAction, extendPending] = useActionState(
    adminExtendSubscriptionFormAction,
    null,
  );

  const showPause = adminCanForcePauseRunStatus(runStatus);
  const showResume = runStatus === "paused_admin";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {showPause ? (
        <GlassPanel className="space-y-3 border border-amber-500/20 bg-amber-500/5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
            Force pause
          </h3>
          <form action={pauseAction} className="space-y-2">
            <input type="hidden" name="runId" value={runId} />
            <textarea
              id={pauseNoteId}
              name="adminNotes"
              required
              rows={2}
              disabled={pausePending}
              placeholder="Audit note (required)"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-[var(--text-primary)]"
            />
            <button
              type="submit"
              disabled={pausePending}
              className="rounded-lg bg-amber-600/30 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-50"
            >
              {pausePending ? "Pausing…" : "Pause run"}
            </button>
            {pauseState?.message ? (
              <p
                className={
                  pauseState.ok ? "text-xs text-emerald-300" : "text-xs text-red-300"
                }
              >
                {pauseState.message}
              </p>
            ) : null}
          </form>
        </GlassPanel>
      ) : null}

      {showResume ? (
        <GlassPanel className="space-y-3 border border-sky-500/20 bg-sky-500/5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-200/90">
            Admin resume
          </h3>
          <p className="text-[11px] text-[var(--text-muted)]">
            Requires valid subscription, strategy, capital/leverage, Delta test,
            and no overdue revenue ledgers. Exchange issues return an error; status
            stays paused_admin.
          </p>
          <form action={resumeAction} className="space-y-2">
            <input type="hidden" name="runId" value={runId} />
            <textarea
              id={resumeNoteId}
              name="adminNotes"
              required
              rows={2}
              disabled={resumePending}
              placeholder="Audit note (required)"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-[var(--text-primary)]"
            />
            <button
              type="submit"
              disabled={resumePending}
              className="rounded-lg bg-sky-600/40 px-3 py-1.5 text-xs font-semibold text-sky-100 disabled:opacity-50"
            >
              {resumePending ? "Resuming…" : "Resume to active"}
            </button>
            {resumeState?.message ? (
              <p
                className={
                  resumeState.ok ? "text-xs text-emerald-300" : "text-xs text-red-300"
                }
              >
                {resumeState.message}
              </p>
            ) : null}
          </form>
        </GlassPanel>
      ) : null}

      <GlassPanel className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Extend access
        </h3>
        <p className="text-[11px] text-[var(--text-muted)]">
          Adds days to <code className="text-[var(--text-primary)]">access_valid_until</code>{" "}
          from max(now, current end), same stacking idea as renewals.
        </p>
        <form action={extendAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <label className="flex flex-col text-xs text-[var(--text-muted)]">
            Days
            <input
              name="addDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={7}
              required
              disabled={extendPending}
              className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-2 py-1.5 text-sm text-[var(--text-primary)] sm:w-24"
            />
          </label>
          <button
            type="submit"
            disabled={extendPending}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            {extendPending ? "Extending…" : "Extend"}
          </button>
        </form>
        {extendState?.message ? (
          <p
            className={
              extendState.ok ? "text-xs text-emerald-300" : "text-xs text-red-300"
            }
          >
            {extendState.message}
          </p>
        ) : null}
      </GlassPanel>

      <div className="lg:col-span-3 flex flex-wrap justify-center gap-3 text-xs text-[var(--text-muted)]">
        <Link href={`/admin/users/${userId}`} className="text-[var(--accent)] hover:underline">
          User profile
        </Link>
        <Link
          href={`/admin/revenue/users/${userId}`}
          className="text-[var(--accent)] hover:underline"
        >
          User billing
        </Link>
      </div>
    </div>
  );
}
