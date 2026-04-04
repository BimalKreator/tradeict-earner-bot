"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  adminRiskControlInitialState,
  toggleGlobalEmergencyStopAction,
  type AdminRiskControlState,
} from "@/server/actions/adminRiskControls";

export function AdminRiskEmergencyForm(props: {
  initialActive: boolean;
  canToggle: boolean;
}) {
  const { initialActive, canToggle } = props;
  const msgRef = useRef<HTMLParagraphElement>(null);

  const [state, formAction, pending] = useActionState<
    AdminRiskControlState,
    FormData
  >(toggleGlobalEmergencyStopAction, adminRiskControlInitialState);

  const isActive =
    state?.ok === true
      ? state.active
      : state?.ok === false
        ? initialActive
        : initialActive;

  useEffect(() => {
    if (state?.message && msgRef.current) {
      msgRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [state?.message]);

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border px-4 py-3 ${
          isActive
            ? "border-rose-500/50 bg-rose-950/35"
            : "border-emerald-500/30 bg-emerald-950/20"
        }`}
      >
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Status:{" "}
          <span className={isActive ? "text-rose-200" : "text-emerald-200"}>
            {isActive ? "ACTIVE — trading halted" : "Inactive — normal gates"}
          </span>
        </p>
      </div>

      {canToggle ? (
        <form action={formAction} className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="active"
            value="true"
            disabled={pending || isActive}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Engage emergency stop
          </button>
          <button
            type="submit"
            name="active"
            value="false"
            disabled={pending || !isActive}
            className="rounded-lg border border-[var(--border-glass)] bg-white/5 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear emergency stop
          </button>
        </form>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Your account cannot change this flag. Ask a super admin to engage or
          clear the global stop.
        </p>
      )}

      {state?.message ? (
        <p
          ref={msgRef}
          className={`text-sm ${
            state.ok ? "text-emerald-200" : "text-amber-200"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
