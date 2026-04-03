"use client";

import Link from "next/link";
import { useActionState, useMemo } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type LoginPasswordState,
  submitLoginPasswordAction,
} from "@/server/actions/authLogin";

const initialState: LoginPasswordState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

type Props = {
  nextPath: string;
  queryError?: string | null;
  resetOk?: boolean;
  showDevStub: boolean;
};

export function LoginForm({
  nextPath,
  queryError,
  resetOk,
  showDevStub,
}: Props) {
  const [state, formAction, pending] = useActionState(
    submitLoginPasswordAction,
    initialState,
  );

  const bannerError = useMemo(() => {
    if (queryError === "admin") {
      return "Please use an administrator account to access the admin panel.";
    }
    if (queryError === "user") {
      return "This area is for subscribers. Sign in with your user account.";
    }
    return null;
  }, [queryError]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Enter your email and password. We will email you a one-time code to
          finish signing in.
        </p>

        {resetOk ? (
          <p
            className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
            role="status"
          >
            Password updated. Sign in with your new password.
          </p>
        ) : null}

        {bannerError ? (
          <p
            className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            role="status"
          >
            {bannerError}
          </p>
        ) : null}

        {state.error ? (
          <p
            className="mt-4 rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)]"
            role="alert"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="you@example.com"
            />
            {fieldError(state.fieldErrors, "email")}
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="Your password"
            />
            {fieldError(state.fieldErrors, "password")}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] shadow-lg shadow-sky-500/15 transition hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Continue…" : "Continue to email code"}
          </button>
        </form>

        <p className="mt-3 text-center text-sm">
          <Link
            href="/forgot-password"
            className="text-[var(--accent)] hover:underline"
          >
            Forgot password?
          </Link>
        </p>

        {showDevStub ? (
          <div className="mt-8 border-t border-[var(--border-glass)] pt-6">
            <p className="text-xs text-[var(--text-muted)]">
              Developer shortcut: stub session (bypasses password + OTP). Not for
              production.
            </p>
            <form action="/api/auth/stub" method="post" className="mt-3">
              <input type="hidden" name="next" value={nextPath} />
              <button
                type="submit"
                className="w-full rounded-xl border border-dashed border-[var(--border-glass)] py-2.5 text-xs font-medium text-[var(--text-muted)] hover:bg-white/5"
              >
                Continue with stub session
              </button>
            </form>
          </div>
        ) : null}

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          No account?{" "}
          <Link href="/register" className="text-[var(--accent)] hover:underline">
            Register
          </Link>
        </p>
      </GlassPanel>
    </div>
  );
}
