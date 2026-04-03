"use client";

import { useActionState, useEffect, useRef } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type ChangePasswordState,
  changePasswordFromProfileAction,
} from "@/server/actions/userPassword";

const initial: ChangePasswordState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

export function UserProfilePasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordFromProfileAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
    }
  }, [state.ok]);

  return (
    <GlassPanel className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Change password
      </h2>
      <p className="text-xs text-[var(--text-muted)]">
        Password updates apply immediately and do not require admin approval.
      </p>

      {state.ok ? (
        <p
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
          role="status"
        >
          Password updated successfully.
        </p>
      ) : null}

      {state.error ? (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      <form ref={formRef} action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="pw-current"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Current password
          </label>
          <input
            id="pw-current"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "currentPassword")}
        </div>
        <div>
          <label
            htmlFor="pw-new"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            New password
          </label>
          <input
            id="pw-new"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "newPassword")}
        </div>
        <div>
          <label
            htmlFor="pw-confirm"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Confirm new password
          </label>
          <input
            id="pw-confirm"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "confirmPassword")}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl border border-[var(--border-glass)] py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-white/5 disabled:opacity-60"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>
    </GlassPanel>
  );
}
