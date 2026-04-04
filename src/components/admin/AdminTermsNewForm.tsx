"use client";

import { useActionState } from "react";

import {
  createTermsDraftAction,
  type AdminTermsActionState,
} from "@/server/actions/adminTermsActions";

export function AdminTermsNewForm() {
  const [state, action] = useActionState(
    createTermsDraftAction,
    null as AdminTermsActionState,
  );

  return (
    <form action={action} className="space-y-4">
      <label className="block text-xs font-medium text-[var(--text-muted)]">
        Version name
        <input
          name="versionName"
          required
          placeholder='e.g. v1.0 or "2026 Update"'
          className="mt-1 w-full max-w-md rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <label className="block text-xs font-medium text-[var(--text-muted)]">
        Content (Markdown)
        <textarea
          name="content"
          required
          rows={18}
          defaultValue={
            "# Terms & conditions\n\nDescribe platform rules, risk, and IST settlement windows.\n"
          }
          className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 font-mono text-sm text-[var(--text-primary)]"
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-red-300">{state.error}</p>
      ) : null}
      <button
        type="submit"
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
      >
        Create draft
      </button>
    </form>
  );
}
