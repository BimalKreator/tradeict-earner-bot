"use client";

import { useActionState, useId } from "react";

import { adminForcePauseRunFormAction } from "@/server/actions/adminUserStrategyControls";

import { GlassPanel } from "@/components/ui/GlassPanel";

export function AdminUserStrategyForcePauseForm({
  runId,
  strategyName,
}: {
  runId: string;
  strategyName: string;
}) {
  const noteId = useId();
  const [state, formAction, pending] = useActionState(
    adminForcePauseRunFormAction,
    null,
  );

  return (
    <GlassPanel className="mt-3 border border-amber-500/20 bg-amber-500/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
        Force pause run
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Sets run status to <code className="text-amber-100">paused_admin</code> for{" "}
        <span className="text-[var(--text-primary)]">{strategyName}</span>. User
        cannot self-activate until support resumes the run.
      </p>
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="runId" value={runId} />
        <label htmlFor={noteId} className="sr-only">
          Internal note (required)
        </label>
        <textarea
          id={noteId}
          name="adminNotes"
          required
          rows={2}
          disabled={pending}
          placeholder="Internal note (audit log) — required"
          className="w-full rounded-lg border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-amber-500/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
        >
          {pending ? "Applying…" : "Force pause"}
        </button>
        {state?.message ? (
          <p
            role="status"
            className={
              state.ok === true
                ? "text-xs text-emerald-200"
                : "text-xs text-amber-200"
            }
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </GlassPanel>
  );
}
