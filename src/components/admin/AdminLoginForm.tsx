"use client";

import Link from "next/link";
import { useActionState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type AdminLoginState,
  adminLoginAction,
} from "@/server/actions/adminAuth";

const initial: AdminLoginState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

export function AdminLoginForm() {
  const [state, formAction, pending] = useActionState(adminLoginAction, initial);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Staff sign in
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Enter your staff email and password to open the admin panel.
        </p>

        {state.error ? (
          <p
            className="mt-4 rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)]"
            role="alert"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="admin-login-email"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Email
            </label>
            <input
              id="admin-login-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="you@tradeictearner.online"
            />
            {fieldError(state.fieldErrors, "email")}
          </div>
          <div>
            <label
              htmlFor="admin-login-password"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Password
            </label>
            <input
              id="admin-login-password"
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
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          <Link href="/" className="text-[var(--accent)] hover:underline">
            ← Public site
          </Link>
        </p>
      </GlassPanel>
    </div>
  );
}
