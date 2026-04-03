"use client";

import Link from "next/link";
import { useActionState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type ResendResetOtpState,
  type ResetPasswordState,
  resendPasswordResetOtpAction,
  resetPasswordWithOtpAction,
} from "@/server/actions/authPasswordReset";

const r0: ResetPasswordState = {};
const s0: ResendResetOtpState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    resetPasswordWithOtpAction,
    r0,
  );
  const [resendState, resendAction, resendPending] = useActionState(
    resendPasswordResetOtpAction,
    s0,
  );

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
          Set new password
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Enter the code from your email and choose a new password.
        </p>
        {state.error ? (
          <p className="mt-4 text-sm text-red-300">{state.error}</p>
        ) : null}
        {resendState.error ? (
          <p className="mt-2 text-xs text-amber-200">{resendState.error}</p>
        ) : null}
        {resendState.ok ? (
          <p className="mt-2 text-xs text-emerald-400">New code sent.</p>
        ) : null}
        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              6-digit code
            </label>
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {fieldError(state.fieldErrors, "code")}
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              New password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {fieldError(state.fieldErrors, "password")}
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Confirm password
            </label>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {fieldError(state.fieldErrors, "confirmPassword")}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] disabled:opacity-60"
          >
            {pending ? "Saving…" : "Update password"}
          </button>
        </form>
        <form action={resendAction} className="mt-4">
          <button
            type="submit"
            disabled={resendPending}
            className="w-full rounded-xl border border-[var(--border-glass)] py-2 text-sm text-[var(--text-muted)] hover:bg-white/5 disabled:opacity-50"
          >
            {resendPending ? "Sending…" : "Resend code"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </GlassPanel>
    </div>
  );
}
