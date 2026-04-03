"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type ResendOtpState,
  type VerifyOtpState,
  resendLoginOtpAction,
  verifyLoginOtpAction,
} from "@/server/actions/authLogin";

const verifyInitial: VerifyOtpState = {};
const resendInitial: ResendOtpState = {};

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

type Props = { nextPath: string };

export function VerifyLoginForm({ nextPath }: Props) {
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyLoginOtpAction,
    verifyInitial,
  );
  const [resendState, resendAction, resendPending] = useActionState(
    resendLoginOtpAction,
    resendInitial,
  );
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const sec = resendState.cooldownSec;
    if (sec != null && sec > 0) {
      setCooldown(sec);
    }
  }, [resendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          We sent a 6-digit code to your inbox. Enter it below to complete sign
          in. The code expires in 10 minutes.
        </p>

        {verifyState.error ? (
          <p
            className="mt-4 rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)]"
            role="alert"
          >
            {verifyState.error}
          </p>
        ) : null}

        {resendState.error ? (
          <p className="mt-2 text-xs text-[var(--danger)]">{resendState.error}</p>
        ) : null}
        {resendState.ok ? (
          <p className="mt-2 text-xs text-emerald-400">New code sent.</p>
        ) : null}

        <form action={verifyAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <div>
            <label
              htmlFor="otp-code"
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Verification code
            </label>
            <input
              id="otp-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
              placeholder="000000"
            />
            {fieldError(verifyState.fieldErrors, "code")}
          </div>
          <button
            type="submit"
            disabled={verifyPending}
            className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] transition hover:brightness-110 disabled:opacity-60"
          >
            {verifyPending ? "Verifying…" : "Verify and sign in"}
          </button>
        </form>

        <form action={resendAction} className="mt-4">
          <button
            type="submit"
            disabled={resendPending || cooldown > 0}
            className="w-full rounded-xl border border-[var(--border-glass)] py-2.5 text-sm text-[var(--text-muted)] hover:bg-white/5 disabled:opacity-50"
          >
            {cooldown > 0
              ? `Resend code (${cooldown}s)`
              : resendPending
                ? "Sending…"
                : "Resend code"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            ← Back to login
          </Link>
        </p>
      </GlassPanel>
    </div>
  );
}
