"use client";

import { useActionState, useEffect, useId, useRef } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  type SaveDeltaIndiaExchangeState,
  saveDeltaIndiaExchangeAction,
  type TestDeltaIndiaExchangeState,
  testDeltaIndiaExchangeAction,
  type ToggleDeltaIndiaExchangeState,
  toggleDeltaIndiaExchangeAction,
} from "@/server/actions/exchangeConnection";

import {
  deriveExchangeConnectionUiStatus,
  exchangeConnectionUiLabel,
  type ExchangeConnectionDisplayInput,
} from "@/lib/exchange-connection-display";

const saveInitial: SaveDeltaIndiaExchangeState = {};
const testInitial: TestDeltaIndiaExchangeState = {};
const toggleInitial: ToggleDeltaIndiaExchangeState = {};

function statusTone(ui: string): string {
  switch (ui) {
    case "connected":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "invalid":
    case "failed":
    case "error_state":
    case "permission_issue":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "disabled":
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
    default:
      return "border-[var(--border-glass)] bg-black/20 text-[var(--text-muted)]";
  }
}

export type ExchangeConnectionPanelProps = {
  connection: ExchangeConnectionDisplayInput & { id: string | null };
};

export function ExchangeConnectionPanel({ connection }: ExchangeConnectionPanelProps) {
  const baseId = useId();
  const sharedFormRef = useRef<HTMLFormElement>(null);
  const [saveState, saveAction, savePending] = useActionState(
    saveDeltaIndiaExchangeAction,
    saveInitial,
  );
  const [testState, testAction, testPending] = useActionState(
    testDeltaIndiaExchangeAction,
    testInitial,
  );
  const [toggleState, toggleAction, togglePending] = useActionState(
    toggleDeltaIndiaExchangeAction,
    toggleInitial,
  );

  useEffect(() => {
    if (saveState.ok) {
      sharedFormRef.current?.reset();
    }
  }, [saveState.ok]);

  const derived = deriveExchangeConnectionUiStatus(
    connection.id
      ? {
          status: connection.status,
          hasStoredCredentials: connection.hasStoredCredentials,
          lastTestStatus: connection.lastTestStatus,
          lastTestAt: connection.lastTestAt,
          lastTestMessage: connection.lastTestMessage,
        }
      : null,
  );

  const isOn = connection.status === "active" || connection.status === "error";
  const adminLocked = connection.status === "disabled_admin";
  const canToggle =
    Boolean(connection.id) &&
    connection.hasStoredCredentials &&
    !adminLocked;

  return (
    <div className="space-y-6">
      <GlassPanel className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Connection status
        </h2>
        <p
          className={`rounded-xl border px-3 py-2 text-sm ${statusTone(derived.ui)}`}
          role="status"
        >
          <span className="font-medium text-[var(--text-primary)]">
            {exchangeConnectionUiLabel(derived.ui)}
          </span>
          {derived.detail ? (
            <span className="mt-1 block text-xs opacity-90">{derived.detail}</span>
          ) : null}
        </p>
        {connection.lastTestAt ? (
          <p className="text-xs text-[var(--text-muted)]">
            Last test:{" "}
            {new Intl.DateTimeFormat("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            }).format(connection.lastTestAt)}{" "}
            IST
          </p>
        ) : null}
      </GlassPanel>

      <GlassPanel className="space-y-4 border-amber-500/20 bg-amber-500/5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-100/90">
          API key safety
        </h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-amber-50/90">
          <li>
            <strong className="font-medium">Do not enable withdrawal</strong> on
            this API key. Use read and trade permissions only, per Delta India
            guidance.
          </li>
          <li>
            Secrets are encrypted on the server and are{" "}
            <strong className="font-medium">never shown again</strong> after you
            save.
          </li>
        </ul>
      </GlassPanel>

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Delta Exchange India
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Connect your Delta India account. We validate access with a read-only
          wallet balances call; automated trading is not enabled in this phase.
        </p>

        {saveState.ok && saveState.message ? (
          <p
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
            role="status"
          >
            {saveState.message}
          </p>
        ) : null}
        {saveState.error ? (
          <p
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            role="alert"
          >
            {saveState.error}
          </p>
        ) : null}

        {testState.ok && testState.message ? (
          <p
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
            role="status"
          >
            {testState.message}
          </p>
        ) : null}
        {testState.error ? (
          <p
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            role="alert"
          >
            {testState.error}
          </p>
        ) : null}

        <form ref={sharedFormRef} className="space-y-4">
          <div>
            <label
              htmlFor={`${baseId}-api-key`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              API key
            </label>
            <input
              id={`${baseId}-api-key`}
              name="api_key"
              type="text"
              autoComplete="off"
              placeholder={
                connection.hasStoredCredentials
                  ? "•••••••• (saved — enter new key to replace)"
                  : "Paste API key"
              }
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
          </div>
          <div>
            <label
              htmlFor={`${baseId}-api-secret`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              API secret
            </label>
            <input
              id={`${baseId}-api-secret`}
              name="api_secret"
              type="password"
              autoComplete="new-password"
              placeholder={
                connection.hasStoredCredentials
                  ? "•••••••• (saved — enter new secret to replace)"
                  : "Paste API secret"
              }
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              formAction={saveAction}
              disabled={savePending || testPending}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {savePending ? "Saving…" : "Save"}
            </button>
            <button
              type="submit"
              formAction={testAction}
              disabled={savePending || testPending}
              className="rounded-xl border border-[var(--border-glass)] bg-black/25 px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50"
            >
              {testPending ? "Testing…" : "Test connection"}
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Test uses the fields above when both are filled; otherwise it uses your
            last saved credentials.
          </p>
        </form>
      </GlassPanel>

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Enable for automation
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          When this is off, your keys stay stored but strategies will not use this
          connection (Phase 9+).
        </p>
        {toggleState.error ? (
          <p
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            role="alert"
          >
            {toggleState.error}
          </p>
        ) : null}
        {toggleState.ok && toggleState.message ? (
          <p
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
            role="status"
          >
            {toggleState.message}
          </p>
        ) : null}
        {adminLocked ? (
          <p className="text-sm text-amber-100/90">
            This connection was disabled by an administrator. Contact support to
            re-enable.
          </p>
        ) : (
          <form action={toggleAction} className="flex flex-wrap items-center gap-3">
            <input
              type="hidden"
              name="enable"
              value={isOn ? "false" : "true"}
            />
            <button
              type="submit"
              disabled={!canToggle || togglePending}
              className={`rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                isOn
                  ? "border border-red-400/40 bg-red-500/15 text-red-100"
                  : "bg-emerald-600/90 text-white"
              }`}
            >
              {togglePending
                ? "Updating…"
                : isOn
                  ? "Turn connection off"
                  : "Turn connection on"}
            </button>
            {!connection.hasStoredCredentials ? (
              <span className="text-xs text-[var(--text-muted)]">
                Save credentials first.
              </span>
            ) : null}
          </form>
        )}
      </GlassPanel>
    </div>
  );
}
