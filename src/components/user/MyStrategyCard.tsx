"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatDateTimeIST } from "@/lib/access-remaining-days-ist";
import { formatInrAmount } from "@/lib/format-inr";
import { runStatusLabel } from "@/lib/my-strategy-run-labels";
import {
  activateStrategyRunAction,
  pauseStrategyRunAction,
  unsubscribeStrategyRunAction,
} from "@/server/actions/userStrategyRun";
import { strategyRunActionInitialState } from "@/server/actions/userStrategyRun.state";
import type { MyStrategyRow } from "@/server/queries/user-my-strategies";

import { GlassPanel } from "@/components/ui/GlassPanel";

export type MyStrategyCardViewModel = MyStrategyRow & {
  isSubscriptionExpired: boolean;
  remainingCalendarDaysIST: number;
  canActivate: boolean;
  canPause: boolean;
  canUnsubscribe: boolean;
  activateButtonLabel: string;
  settingsMissing: boolean;
  showRenewCta: boolean;
};

function runBadgeClass(status: MyStrategyRow["runStatus"]): string {
  if (status === "active") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-100";
  }
  if (status === "ready_to_activate") {
    return "border-sky-500/35 bg-sky-500/10 text-sky-100";
  }
  if (
    status === "paused_by_user" ||
    status === "paused" ||
    status === "paused_exchange_off" ||
    status === "paused_insufficient_funds"
  ) {
    return "border-amber-500/35 bg-amber-500/10 text-amber-100";
  }
  if (status === "paused_admin") {
    return "border-rose-500/35 bg-rose-500/10 text-rose-100";
  }
  if (status === "expired" || status === "blocked_revenue_due") {
    return "border-slate-500/35 bg-slate-500/15 text-slate-200";
  }
  return "border-white/[0.12] bg-black/25 text-[var(--text-muted)]";
}

export function MyStrategyCard({ row }: { row: MyStrategyCardViewModel }) {
  const router = useRouter();
  const msgRef = useRef<HTMLParagraphElement>(null);
  const [unsubModalOpen, setUnsubModalOpen] = useState(false);
  const [activateState, activateAction, activatePending] = useActionState(
    activateStrategyRunAction,
    strategyRunActionInitialState,
  );
  const [pauseState, pauseAction, pausePending] = useActionState(
    pauseStrategyRunAction,
    strategyRunActionInitialState,
  );
  const [unsubState, unsubAction, unsubPending] = useActionState(
    unsubscribeStrategyRunAction,
    strategyRunActionInitialState,
  );

  const feedback =
    activateState.message ||
    pauseState.message ||
    unsubState.message ||
    "";
  const feedbackOk =
    activateState.ok === true ||
    pauseState.ok === true ||
    unsubState.ok === true
      ? true
      : activateState.ok === false ||
          pauseState.ok === false ||
          unsubState.ok === false
        ? false
        : null;

  const settingsHrefFromAction = activateState.settingsHref;

  useEffect(() => {
    if (feedback && msgRef.current) {
      msgRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [feedback]);

  useEffect(() => {
    if (unsubState.ok === true) {
      setUnsubModalOpen(false);
    }
    if (
      activateState.ok === true ||
      pauseState.ok === true ||
      unsubState.ok === true
    ) {
      router.refresh();
    }
  }, [activateState.ok, pauseState.ok, unsubState.ok, router]);

  const settingsHref = `/user/my-strategies/${encodeURIComponent(row.slug)}/settings`;
  const renewHref = `/user/strategies/${encodeURIComponent(row.slug)}/checkout?intent=renew`;

  const anyPending = activatePending || pausePending || unsubPending;

  return (
    <GlassPanel className="relative flex h-full flex-col overflow-hidden border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent">
      {unsubModalOpen ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => !unsubPending && setUnsubModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`unsub-title-${row.subscriptionId}`}
            className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#0b1220] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id={`unsub-title-${row.subscriptionId}`}
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
            >
              Remove this strategy?
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              This unsubscribes you from <span className="font-medium text-white">{row.name}</span>.
              The bot will stop taking new trades, and this card will disappear from My strategies.
              Existing exchange positions are not auto-closed here — close them on Delta if needed.
            </p>
            {unsubState.ok === false && unsubState.message ? (
              <p className="mt-3 text-sm text-red-200/95" role="alert">
                {unsubState.message}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={unsubPending}
                onClick={() => setUnsubModalOpen(false)}
                className="rounded-xl border border-white/[0.15] bg-white/[0.06] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
              >
                Cancel
              </button>
              <form action={unsubAction} className="inline">
                <input type="hidden" name="subscriptionId" value={row.subscriptionId} />
                <button
                  type="submit"
                  disabled={unsubPending}
                  className="rounded-xl border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/30 disabled:opacity-50"
                >
                  {unsubPending ? "Removing…" : "Remove / Unsubscribe"}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
            {row.name}
          </h2>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${runBadgeClass(row.runStatus)}`}
          >
            {runStatusLabel(row.runStatus)}
          </span>
        </div>

        {row.strategyStatus !== "active" && !row.isSubscriptionExpired ? (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            This strategy is not available for trading right now (catalog status:{" "}
            <span className="font-medium">{row.strategyStatus}</span>).
          </p>
        ) : null}

        {row.description ? (
          <p className="text-sm leading-relaxed text-[var(--text-muted)] line-clamp-3">
            {row.description}
          </p>
        ) : (
          <p className="text-sm italic text-[var(--text-muted)]/70">
            No description yet.
          </p>
        )}

        <div className="space-y-2 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Monthly fee (INR)
              </p>
              <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                {formatInrAmount(row.monthlyFeeInr)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Revenue share
              </p>
              <p className="text-lg font-semibold tabular-nums text-sky-200/90">
                {row.revenueSharePercent}%
              </p>
            </div>
          </div>
          {row.hasPricingOverride ? (
            <span className="inline-block rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
              Overridden for your account
            </span>
          ) : null}
        </div>

        <dl className="grid gap-2 text-sm text-[var(--text-muted)]">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Subscribed on</dt>
            <dd className="text-right text-[var(--text-primary)]">
              {formatDateTimeIST(row.purchasedAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Valid until</dt>
            <dd className="text-right text-[var(--text-primary)]">
              {formatDateTimeIST(row.accessValidUntil)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Remaining (IST calendar days)</dt>
            <dd className="text-right font-medium tabular-nums text-[var(--text-primary)]">
              {row.isSubscriptionExpired ? "—" : row.remainingCalendarDaysIST}
            </dd>
          </div>
        </dl>

        {row.canActivate && row.settingsMissing ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <p className="font-medium text-amber-50">
              Capital and Leverage settings are missing
            </p>
            <p className="mt-1 text-amber-100/90">
              Save both values on the strategy settings page before you can
              activate or resume.
            </p>
            <Link
              href={settingsHref}
              className="mt-2 inline-flex items-center justify-center rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-500/30"
            >
              Open strategy settings
            </Link>
          </div>
        ) : null}

        {row.runStatus === "active" ? (
          <p className="text-xs text-sky-200/85">
            New settings will apply to future trades only.
          </p>
        ) : null}

        {feedback ? (
          <div ref={msgRef} className="space-y-2">
            <p
              role="status"
              className={
                feedbackOk === true
                  ? "text-sm text-emerald-200/95"
                  : feedbackOk === false
                    ? "text-sm text-amber-100/95"
                    : "text-sm text-[var(--text-muted)]"
              }
            >
              {feedback}
            </p>
            {settingsHrefFromAction ? (
              <Link
                href={settingsHrefFromAction}
                className="inline-flex rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-500/25"
              >
                Open strategy settings
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto space-y-2 pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Quick actions
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {row.canActivate ? (
            <form action={activateAction} className="min-w-0 flex-1">
              <input type="hidden" name="subscriptionId" value={row.subscriptionId} />
              <button
                type="submit"
                disabled={anyPending || row.settingsMissing}
                className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 py-2.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50"
              >
                {activatePending
                  ? "Working…"
                  : row.activateButtonLabel}
              </button>
            </form>
          ) : null}
          {row.canPause ? (
            <form action={pauseAction} className="min-w-0 flex-1">
              <input type="hidden" name="subscriptionId" value={row.subscriptionId} />
              <button
                type="submit"
                disabled={anyPending}
                className="w-full rounded-xl border border-amber-500/40 bg-amber-500/15 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-50"
              >
                {pausePending ? "Pausing…" : "Pause Strategy"}
              </button>
            </form>
          ) : null}
          {row.canUnsubscribe ? (
            <div className="min-w-0 flex-1">
              <button
                type="button"
                disabled={anyPending}
                onClick={() => setUnsubModalOpen(true)}
                className="w-full rounded-xl border border-red-500/40 bg-red-500/10 py-2.5 text-sm font-medium text-red-100 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                Remove / Unsubscribe
              </button>
            </div>
          ) : null}
          <Link
            href={settingsHref}
            className="inline-flex w-full flex-1 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-white/[0.07]"
          >
            Settings
          </Link>
          {row.showRenewCta ? (
            <Link
              href={renewHref}
              className="inline-flex w-full flex-1 items-center justify-center rounded-xl border border-sky-500/35 bg-sky-500/10 py-2.5 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
            >
              Renew
            </Link>
          ) : null}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
