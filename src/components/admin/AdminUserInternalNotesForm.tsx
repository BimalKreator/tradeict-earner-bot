"use client";

import { useActionState, useEffect } from "react";

import {
  type UpdateInternalNotesState,
  updateAdminInternalNotesAction,
} from "@/server/actions/adminUsers";

const initial: UpdateInternalNotesState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

type Props = { userId: string; defaultNotes: string };

export function AdminUserInternalNotesForm({ userId, defaultNotes }: Props) {
  const [state, formAction, pending] = useActionState(
    updateAdminInternalNotesAction,
    initial,
  );

  useEffect(() => {
    if (state.ok) {
      window.location.reload();
    }
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <textarea
        name="adminInternalNotes"
        rows={6}
        defaultValue={defaultNotes}
        placeholder="Internal remarks (not visible to the user)…"
        className="w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
      />
      {fieldError(state.fieldErrors, "adminInternalNotes")}
      {state.error ? (
        <p className="text-sm text-red-300">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-white/5 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save internal notes"}
      </button>
    </form>
  );
}
