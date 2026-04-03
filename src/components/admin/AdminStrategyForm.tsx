"use client";

import { useActionState, useId } from "react";
import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import type { AdminStrategyFormDefaults } from "@/lib/admin-strategy-form-defaults";
import {
  type StrategyFormState,
  createStrategyAction,
  updateStrategyAction,
} from "@/server/actions/adminStrategies";

function fieldError(
  fieldErrors: Record<string, string[]> | undefined,
  key: string,
) {
  const msg = fieldErrors?.[key]?.[0];
  return msg ? <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p> : null;
}

const initial: StrategyFormState = {};

type Props =
  | { mode: "create" }
  | { mode: "edit"; strategyId: string; defaults: AdminStrategyFormDefaults };

export function AdminStrategyForm(props: Props) {
  const baseId = useId();
  const [state, formAction, pending] = useActionState(
    props.mode === "create" ? createStrategyAction : updateStrategyAction,
    initial,
  );

  const d =
    props.mode === "edit"
      ? props.defaults
      : ({
          slug: "",
          name: "",
          description: "",
          defaultMonthlyFeeInr: "499.00",
          defaultRevenueSharePercent: "50.00",
          visibility: "public",
          status: "active",
          riskLabel: "medium",
          recommendedCapitalInr: "",
          maxLeverage: "",
          performanceChartJsonText: "[]",
        } satisfies AdminStrategyFormDefaults);

  return (
    <GlassPanel className="space-y-6">
      {state.error ? (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      <form action={formAction} className="space-y-5">
        {props.mode === "edit" ? (
          <input type="hidden" name="strategy_id" value={props.strategyId} />
        ) : null}

        {props.mode === "create" ? (
          <div>
            <label
              htmlFor={`${baseId}-slug`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Slug
            </label>
            <input
              id={`${baseId}-slug`}
              name="slug"
              required
              placeholder="momentum-btc"
              className="mt-1 w-full max-w-md rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
            {fieldError(state.fieldErrors, "slug")}
          </div>
        ) : (
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              Slug
            </p>
            <p className="mt-1 font-mono text-sm text-[var(--accent)]">{d.slug}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Slug is fixed after creation.
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor={`${baseId}-name`}
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Name
          </label>
          <input
            id={`${baseId}-name`}
            name="name"
            required
            defaultValue={d.name}
            className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "name")}
        </div>

        <div>
          <label
            htmlFor={`${baseId}-desc`}
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Description
          </label>
          <textarea
            id={`${baseId}-desc`}
            name="description"
            rows={4}
            defaultValue={d.description}
            className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "description")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${baseId}-fee`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Default monthly fee (INR)
            </label>
            <input
              id={`${baseId}-fee`}
              name="default_monthly_fee_inr"
              required
              defaultValue={d.defaultMonthlyFeeInr}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
            {fieldError(state.fieldErrors, "default_monthly_fee_inr")}
          </div>
          <div>
            <label
              htmlFor={`${baseId}-rev`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Default revenue share (%)
            </label>
            <input
              id={`${baseId}-rev`}
              name="default_revenue_share_percent"
              required
              defaultValue={d.defaultRevenueSharePercent}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
            {fieldError(state.fieldErrors, "default_revenue_share_percent")}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor={`${baseId}-vis`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Visibility
            </label>
            <select
              id={`${baseId}-vis`}
              name="visibility"
              defaultValue={d.visibility}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            >
              <option value="public">Public</option>
              <option value="hidden">Hidden</option>
            </select>
            {fieldError(state.fieldErrors, "visibility")}
          </div>
          <div>
            <label
              htmlFor={`${baseId}-st`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Status
            </label>
            <select
              id={`${baseId}-st`}
              name="status"
              defaultValue={d.status}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
            {fieldError(state.fieldErrors, "status")}
          </div>
          <div>
            <label
              htmlFor={`${baseId}-risk`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Risk label
            </label>
            <select
              id={`${baseId}-risk`}
              name="risk_label"
              defaultValue={d.riskLabel}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            {fieldError(state.fieldErrors, "risk_label")}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${baseId}-cap`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Recommended capital (INR)
            </label>
            <input
              id={`${baseId}-cap`}
              name="recommended_capital_inr"
              placeholder="Optional"
              defaultValue={d.recommendedCapitalInr}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
            {fieldError(state.fieldErrors, "recommended_capital_inr")}
          </div>
          <div>
            <label
              htmlFor={`${baseId}-lev`}
              className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Max leverage
            </label>
            <input
              id={`${baseId}-lev`}
              name="max_leverage"
              placeholder="Optional"
              defaultValue={d.maxLeverage}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
            />
            {fieldError(state.fieldErrors, "max_leverage")}
          </div>
        </div>

        <div>
          <label
            htmlFor={`${baseId}-chart`}
            className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Performance chart (JSON array)
          </label>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Array of objects with <code className="text-[var(--accent)]">date</code>{" "}
            (string) and <code className="text-[var(--accent)]">value</code> (number).
          </p>
          <textarea
            id={`${baseId}-chart`}
            name="performance_chart_json"
            rows={8}
            defaultValue={d.performanceChartJsonText}
            spellCheck={false}
            className="mt-2 w-full rounded-xl border border-[var(--border-glass)] bg-black/40 px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
          />
          {fieldError(state.fieldErrors, "performance_chart_json")}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {pending ? "Saving…" : props.mode === "create" ? "Create strategy" : "Save changes"}
          </button>
          <Link
            href={
              props.mode === "edit"
                ? `/admin/strategies/${props.strategyId}`
                : "/admin/strategies"
            }
            className="rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </Link>
        </div>
      </form>
    </GlassPanel>
  );
}
