"use client";

import Link from "next/link";
import { useActionState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type ForgotPasswordState,
  requestPasswordResetAction,
} from "@/server/actions/authPasswordReset";

const initial: ForgotPasswordState = {};

export function ForgotPasswordForm({ sent }: { sent: boolean }) {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initial,
  );

  if (sent) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <GlassPanel>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Check your email
          </h1>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            If an account exists for that address, we sent instructions. For
            privacy we show this message either way.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            ← Back to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
          Forgot password
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Enter your email. We will send a 6-digit code to reset your password.
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
              autoComplete="email"
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {state.fieldErrors?.email?.[0] ? (
              <p className="mt-1 text-xs text-[var(--danger)]">
                {state.fieldErrors.email[0]}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send reset code"}
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
