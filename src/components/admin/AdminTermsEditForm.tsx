"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  archiveTermsVersionAction,
  duplicateTermsAsDraftAction,
  publishTermsVersionAction,
  updateTermsVersionAction,
  type AdminTermsActionState,
} from "@/server/actions/adminTermsActions";

type Row = {
  id: string;
  versionName: string;
  content: string;
  status: "draft" | "published" | "archived";
};

export function AdminTermsEditForm({ row }: { row: Row }) {
  const router = useRouter();
  const readOnly = row.status === "published";

  const [saveState, saveAction] = useActionState(
    updateTermsVersionAction,
    null as AdminTermsActionState,
  );
  const [pubState, pubAction] = useActionState(
    publishTermsVersionAction,
    null as AdminTermsActionState,
  );
  const [archState, archAction] = useActionState(
    archiveTermsVersionAction,
    null as AdminTermsActionState,
  );
  const [dupState, dupAction] = useActionState(
    duplicateTermsAsDraftAction,
    null as AdminTermsActionState,
  );

  useEffect(() => {
    if (saveState?.ok || pubState?.ok || archState?.ok) {
      router.refresh();
    }
  }, [saveState?.ok, pubState?.ok, archState?.ok, router]);

  return (
    <div className="space-y-8">
      {readOnly ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100/90">
          This version is <strong>published</strong> and is shown on the public site. You cannot
          edit it in place. Duplicate as a new draft to prepare changes, or archive it (the site
          will show the fallback until another version is published).
        </div>
      ) : null}

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="id" value={row.id} />
        <label className="block text-xs font-medium text-[var(--text-muted)]">
          Version name
          <input
            name="versionName"
            required
            defaultValue={row.versionName}
            readOnly={readOnly}
            disabled={readOnly}
            className="mt-1 w-full max-w-md rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-60"
          />
        </label>
        <label className="block text-xs font-medium text-[var(--text-muted)]">
          Content (Markdown)
          <textarea
            name="content"
            required
            rows={22}
            defaultValue={row.content}
            readOnly={readOnly}
            disabled={readOnly}
            className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 font-mono text-sm text-[var(--text-primary)] disabled:opacity-60"
          />
        </label>
        {saveState?.error ? (
          <p className="text-sm text-red-300">{saveState.error}</p>
        ) : null}
        {saveState?.ok ? (
          <p className="text-sm text-emerald-300/90">Saved.</p>
        ) : null}
        {!readOnly ? (
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
          >
            Save changes
          </button>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-3 border-t border-[var(--border-glass)] pt-6">
        {row.status !== "published" ? (
          <form action={pubAction}>
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              className="rounded-lg bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              Publish
            </button>
          </form>
        ) : null}

        {row.status !== "archived" ? (
          <form action={archAction}>
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20"
            >
              Archive
            </button>
          </form>
        ) : null}

        <form action={dupAction}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className="rounded-lg border border-[var(--border-glass)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-white/5"
          >
            Duplicate as new draft
          </button>
        </form>
      </div>

      {dupState?.error ? (
        <p className="text-sm text-red-300">{dupState.error}</p>
      ) : null}

      {pubState?.error ? (
        <p className="text-sm text-red-300">{pubState.error}</p>
      ) : null}
      {pubState?.ok ? (
        <p className="text-sm text-emerald-300/90">Published. Public /terms is updated.</p>
      ) : null}
      {archState?.error ? (
        <p className="text-sm text-red-300">{archState.error}</p>
      ) : null}
      {archState?.ok ? (
        <p className="text-sm text-emerald-300/90">Archived.</p>
      ) : null}
    </div>
  );
}
