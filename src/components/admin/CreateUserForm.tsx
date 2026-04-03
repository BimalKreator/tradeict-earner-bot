"use client";

import Link from "next/link";
import { useActionState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type CreateAdminUserState,
  createAdminUserAction,
} from "@/server/actions/adminUsers";

const initial: CreateAdminUserState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createAdminUserAction,
    initial,
  );

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
          Add user
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Creates an <strong>approved</strong> account with a random temporary
          password. Credentials are emailed immediately (SMTP required).
        </p>
        {state.error ? (
          <p className="mt-4 text-sm text-red-300">{state.error}</p>
        ) : null}
        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {fieldError(state.fieldErrors, "email")}
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Full name
            </label>
            <input
              name="name"
              type="text"
              required
              minLength={2}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {fieldError(state.fieldErrors, "name")}
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Phone (optional)
            </label>
            <input
              name="phone"
              type="tel"
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {fieldError(state.fieldErrors, "phone")}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create & email credentials"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link
            href="/admin/users"
            className="text-[var(--accent)] hover:underline"
          >
            ← Back to users
          </Link>
        </p>
      </GlassPanel>
    </div>
  );
}
