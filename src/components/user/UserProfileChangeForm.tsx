"use client";

import { useActionState, useEffect, useRef } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type SubmitProfileChangeState,
  submitProfileChangeRequestAction,
} from "@/server/actions/userProfile";

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

type UserRow = {
  name: string | null;
  address: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string;
};

const initial: SubmitProfileChangeState = {};

export function UserProfileChangeForm({
  user,
  hasPendingRequest,
}: {
  user: UserRow;
  hasPendingRequest: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    submitProfileChangeRequestAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
    }
  }, [state.ok]);

  if (hasPendingRequest) {
    return (
      <GlassPanel className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Request profile changes
        </h2>
        <p
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
          role="status"
        >
          A pending profile update is already waiting for admin review. Please
          wait until it is approved or rejected before submitting another
          request.
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Request profile changes
      </h2>
      <p className="text-xs text-[var(--text-muted)]">
        Updates to name, address, mobile, WhatsApp, and email require admin
        approval. Your live profile stays unchanged until approved.
      </p>

      {state.ok && state.messageHi ? (
        <p
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
          role="status"
        >
          <span className="font-medium text-emerald-50">{state.messageHi}</span>
          <span className="mt-1 block text-xs text-emerald-200/90">
            Your update has been sent for admin review.
          </span>
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
            htmlFor="profile-name"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Name
          </label>
          <input
            id="profile-name"
            name="name"
            type="text"
            required
            minLength={2}
            defaultValue={user.name ?? ""}
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "name")}
        </div>
        <div>
          <label
            htmlFor="profile-address"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Address
          </label>
          <textarea
            id="profile-address"
            name="address"
            rows={3}
            defaultValue={user.address ?? ""}
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "address")}
        </div>
        <div>
          <label
            htmlFor="profile-phone"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Mobile number
          </label>
          <input
            id="profile-phone"
            name="phone"
            type="tel"
            required
            defaultValue={user.phone ?? ""}
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "phone")}
        </div>
        <div>
          <label
            htmlFor="profile-wa"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            WhatsApp number
          </label>
          <input
            id="profile-wa"
            name="whatsapp_number"
            type="tel"
            defaultValue={user.whatsappNumber ?? ""}
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "whatsapp_number")}
        </div>
        <div>
          <label
            htmlFor="profile-email"
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Email
          </label>
          <input
            id="profile-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={user.email}
            className="mt-1.5 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "email")}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-[var(--accent-strong)] py-3 text-sm font-semibold text-[var(--bg-void)] shadow-lg shadow-sky-500/15 transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit for admin review"}
        </button>
      </form>
    </GlassPanel>
  );
}
