"use client";

import Link from "next/link";
import { useActionState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type RegisterFormState,
  registerUserAction,
} from "@/server/actions/publicAuth";

const initialState: RegisterFormState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(
    registerUserAction,
    initialState,
  );

  if (state.ok) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
        <GlassPanel>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            Registration received
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
            Your account is{" "}
            <strong className="text-[var(--accent)]">under admin review</strong>
            . You cannot sign in until an administrator approves your
            registration. We will notify you by email once your account is
            active.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] transition hover:brightness-110"
          >
            Back to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Create account
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Register for Tradeict Earner. Your account stays in{" "}
          <strong className="text-[var(--text-primary)]">pending approval</strong>{" "}
          until an admin approves it.
        </p>

        {state.error ? (
          <p
            className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            role="alert"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Full name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="Your name"
            />
            {fieldError(state.fieldErrors, "name")}
          </div>
          <div>
            <label
              htmlFor="phone"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Mobile number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="e.g. 9876543210"
            />
            {fieldError(state.fieldErrors, "phone")}
          </div>
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Email
            </label>
            <input
              id="email"
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
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="At least 8 characters"
            />
            {fieldError(state.fieldErrors, "password")}
          </div>
          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 placeholder:text-slate-500 focus:ring-2"
              placeholder="Repeat password"
            />
            {fieldError(state.fieldErrors, "confirmPassword")}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] shadow-lg shadow-sky-500/15 transition hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Creating account…" : "Register"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Sign in
          </Link>
        </p>
      </GlassPanel>
    </div>
  );
}
