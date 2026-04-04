"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";

import { formatDateTimeIST } from "@/lib/access-remaining-days-ist";
import { formatInrAmount } from "@/lib/format-inr";
import { runStatusLabel } from "@/lib/my-strategy-run-labels";
import {
  activateStrategyRunAction,
  inactivateStrategyRunAction,
  pauseStrategyRunAction,
  strategyRunActionInitialState,
} from "@/server/actions/userStrategyRun";
import type { MyStrategyRow } from "@/server/queries/user-my-strategies";

import { GlassPanel } from "@/components/ui/GlassPanel";

export type MyStrategyCardViewModel = MyStrategyRow & {
  isSubscriptionExpired: boolean;
  remainingCalendarDaysIST: number;
  canActivate: boolean;
  canPause: boolean;
  canInactivate: boolean;
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
  const msgRef = useRef<HTMLParagraphElement>(null);
  const [activateState, activateAction, activatePending] = useActionState(
    activateStrategyRunAction,
    strategyRunActionInitialState,
  );
  const [pauseState, pauseAction, pausePending] = useActionState(
    pauseStrategyRunAction,
    strategyRunActionInitialState,
  );
  const [inactivateState, inactivateAction, inactivatePending] = useActionState(
    inactivateStrategyRunAction,
    strategyRunActionInitialState,
  );

  const feedback =
    activateState.message ||
    pauseState.message ||
    inactivateState.message ||
    "";
  const feedbackOk =
    activateState.ok === true ||
    pauseState.ok === true ||
    inactivateState.ok === true
      ? true
      : activateState.ok === false ||
          pauseState.ok === false ||
          inactivateState.ok === false
        ? false
        : null;

  const settingsHrefFromAction = activateState.settingsHref;

  useEffect(() => {
    if (feedback && msgRef.current) {
      msgRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [feedback]);

  const settingsHref = `/user/my-strategies/${encodeURIComponent(row.slug)}/settings`;
  const renewHref = `/user/strategies/${encodeURIComponent(row.slug)}/checkout?intent=renew`;

  const anyPending = activatePending || pausePending || inactivatePending;

  return (
    <GlassPanel className="flex h-full flex-col overflow-hidden border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent">
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

        <div className="mt-auto flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
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
                className="w-full rounded-xl border border-white/[0.12] bg-black/30 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-black/45 disabled:opacity-50"
              >
                {pausePending ? "Pausing…" : "Pause"}
              </button>
            </form>
          ) : null}
          {row.canInactivate ? (
            <form action={inactivateAction} className="min-w-0 flex-1">
              <input type="hidden" name="subscriptionId" value={row.subscriptionId} />
              <button
                type="submit"
                disabled={anyPending}
                className="w-full rounded-xl border border-slate-500/35 bg-slate-500/10 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-500/20 disabled:opacity-50"
              >
                {inactivatePending ? "Turning off…" : "Inactivate"}
              </button>
            </form>
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
    </GlassPanel>
  );
}
