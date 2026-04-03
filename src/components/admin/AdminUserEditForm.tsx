"use client";

import { useActionState, useEffect } from "react";

import {
  type UpdateUserBasicState,
  updateUserBasicAction,
} from "@/server/actions/adminUsers";

const initial: UpdateUserBasicState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

type Props = {
  userId: string;
  defaultName: string;
  defaultPhone: string;
};

export function AdminUserEditForm({
  userId,
  defaultName,
  defaultPhone,
}: Props) {
  const [state, formAction, pending] = useActionState(
    updateUserBasicAction,
    initial,
  );

  useEffect(() => {
    if (state.ok) {
      window.location.reload();
    }
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Name
        </label>
        <input
          name="name"
          type="text"
          required
          minLength={2}
          defaultValue={defaultName}
          className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        />
        {fieldError(state.fieldErrors, "name")}
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Phone
        </label>
        <input
          name="phone"
          type="tel"
          defaultValue={defaultPhone}
          className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        />
        {fieldError(state.fieldErrors, "phone")}
      </div>
      {state.error ? (
        <p className="text-sm text-red-300">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-[var(--bg-void)] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
