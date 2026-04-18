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
          hedgeScalping: null,
          trendArb: null,
        } satisfies AdminStrategyFormDefaults);

  const showTrendArbAdvanced =
    props.mode === "edit" &&
    (d.slug ?? "").trim().toLowerCase().includes("trend-arb") &&
    d?.trendArb != null;
  const trendArbDefaults = showTrendArbAdvanced ? d?.trendArb ?? null : null;

  const showHedgeScalpingAdvanced =
    props.mode === "edit" &&
    (d.slug ?? "").trim().toLowerCase().includes("hedge-scalping") &&
    d?.hedgeScalping != null;
  const hedgeScalpingDefaults = showHedgeScalpingAdvanced ? d.hedgeScalping : null;

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
              Recommended capital (USD)
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

        {trendArbDefaults ? (
          <div className="space-y-4 rounded-xl border border-[var(--border-glass)] bg-black/20 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Advanced strategy settings
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`${baseId}-trend-symbol`}
                  className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                >
                  Symbol
                </label>
                <input
                  id={`${baseId}-trend-symbol`}
                  name="trend_arb_symbol"
                  required
                  defaultValue={trendArbDefaults.symbol}
                  className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                />
                {fieldError(state.fieldErrors, "trend_arb_symbol")}
              </div>

              <div>
                <label
                  htmlFor={`${baseId}-trend-cap-pct`}
                  className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                >
                  Capital usage (%)
                </label>
                <input
                  id={`${baseId}-trend-cap-pct`}
                  name="trend_arb_capital_allocation_pct"
                  required
                  defaultValue={trendArbDefaults.capitalAllocationPct}
                  className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                />
                {fieldError(state.fieldErrors, "trend_arb_capital_allocation_pct")}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[var(--border-glass)]/70 bg-black/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Indicator settings
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${baseId}-trend-indicator-amplitude`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    HalfTrend amplitude
                  </label>
                  <input
                    id={`${baseId}-trend-indicator-amplitude`}
                    name="trend_arb_indicator_amplitude"
                    type="number"
                    step="1"
                    required
                    defaultValue={trendArbDefaults.indicatorAmplitude}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_indicator_amplitude")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-indicator-channel-dev`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Channel deviation
                  </label>
                  <input
                    id={`${baseId}-trend-indicator-channel-dev`}
                    name="trend_arb_indicator_channel_deviation"
                    type="number"
                    step="1"
                    required
                    defaultValue={trendArbDefaults.indicatorChannelDeviation}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_indicator_channel_deviation")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-indicator-timeframe`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Indicator timeframe
                  </label>
                  <select
                    id={`${baseId}-trend-indicator-timeframe`}
                    name="trend_arb_indicator_timeframe"
                    required
                    defaultValue={trendArbDefaults.indicatorTimeframe}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  >
                    <option value="1m">1m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </select>
                  {fieldError(state.fieldErrors, "trend_arb_indicator_timeframe")}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[var(--border-glass)]/70 bg-black/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Delta 1 configuration
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d1-qty`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Base qty (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d1-qty`}
                    name="trend_arb_d1_entry_qty_pct"
                    required
                    defaultValue={trendArbDefaults.delta1EntryQtyPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d1_entry_qty_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d1-tp`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Target profit (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d1-tp`}
                    name="trend_arb_d1_target_profit_pct"
                    required
                    defaultValue={trendArbDefaults.delta1TargetProfitPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d1_target_profit_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d1-sl`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Stop loss (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d1-sl`}
                    name="trend_arb_d1_stop_loss_pct"
                    required
                    defaultValue={trendArbDefaults.delta1StopLossPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d1_stop_loss_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d1-be`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    D1 breakeven trigger (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d1-be`}
                    name="trend_arb_d1_breakeven_trigger_pct"
                    placeholder="0 = disabled"
                    defaultValue={trendArbDefaults.delta1BreakevenTriggerPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  <p className="mt-1 text-[10px] leading-snug text-[var(--text-muted)]">
                    Peak unrealized profit on D1 must reach this % before stop trails to entry; exit
                    at breakeven if price reverses. Leave empty or 0 to turn off.
                  </p>
                  {fieldError(state.fieldErrors, "trend_arb_d1_breakeven_trigger_pct")}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[var(--border-glass)]/70 bg-black/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Delta 2 configuration
              </h4>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d2-step-move`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Step move (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d2-step-move`}
                    name="trend_arb_d2_step_move_pct"
                    required
                    defaultValue={trendArbDefaults.delta2StepMovePct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d2_step_move_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d2-step-qty`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Step qty (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d2-step-qty`}
                    name="trend_arb_d2_step_qty_pct"
                    required
                    defaultValue={trendArbDefaults.delta2StepQtyPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d2_step_qty_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d2-tp`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Target profit (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d2-tp`}
                    name="trend_arb_d2_target_profit_pct"
                    required
                    defaultValue={trendArbDefaults.delta2TargetProfitPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d2_target_profit_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-trend-d2-sl`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Stop loss (%)
                  </label>
                  <input
                    id={`${baseId}-trend-d2-sl`}
                    name="trend_arb_d2_stop_loss_pct"
                    required
                    defaultValue={trendArbDefaults.delta2StopLossPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "trend_arb_d2_stop_loss_pct")}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {hedgeScalpingDefaults ? (
          <div className="space-y-4 rounded-xl border border-[var(--border-glass)] bg-black/20 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Hedge Scalping (dual account) — settings
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              Phase 1: configuration only. Slug must contain <span className="font-mono">hedge-scalping</span>.
            </p>

            <div className="space-y-3 rounded-lg border border-[var(--border-glass)]/70 bg-black/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                General
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`${baseId}-hs-allowed-symbols`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Allowed symbols (comma-separated)
                  </label>
                  <input
                    id={`${baseId}-hs-allowed-symbols`}
                    name="hs_allowed_symbols"
                    required
                    placeholder="BTCUSD, ETHUSD, SOLUSD"
                    defaultValue={hedgeScalpingDefaults.allowedSymbols}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_allowed_symbols")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-timeframe`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Timeframe
                  </label>
                  <select
                    id={`${baseId}-hs-timeframe`}
                    name="hs_general_timeframe"
                    required
                    defaultValue={hedgeScalpingDefaults.timeframe}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  >
                    <option value="1m">1m</option>
                    <option value="3m">3m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="30m">30m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                  </select>
                  {fieldError(state.fieldErrors, "hs_general_timeframe")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-ht-amp`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    HalfTrend amplitude
                  </label>
                  <input
                    id={`${baseId}-hs-ht-amp`}
                    name="hs_general_half_trend_amplitude"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    defaultValue={hedgeScalpingDefaults.halfTrendAmplitude}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_general_half_trend_amplitude")}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[var(--border-glass)]/70 bg-black/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Delta 1 (main account)
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d1-base`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Base qty (% of capital)
                  </label>
                  <input
                    id={`${baseId}-hs-d1-base`}
                    name="hs_d1_base_qty_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta1BaseQtyPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d1_base_qty_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d1-tp`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Target profit (%)
                  </label>
                  <input
                    id={`${baseId}-hs-d1-tp`}
                    name="hs_d1_target_profit_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta1TargetProfitPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d1_target_profit_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d1-sl`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Stop loss (%)
                  </label>
                  <input
                    id={`${baseId}-hs-d1-sl`}
                    name="hs_d1_stop_loss_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta1StopLossPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d1_stop_loss_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d1-be`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Breakeven trigger (% of target)
                  </label>
                  <input
                    id={`${baseId}-hs-d1-be`}
                    name="hs_d1_breakeven_trigger_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta1BreakevenTriggerPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  <p className="mt-1 text-[10px] leading-snug text-[var(--text-muted)]">
                    When profit reaches this % of the D1 target, move stop to entry (breakeven).
                  </p>
                  {fieldError(state.fieldErrors, "hs_d1_breakeven_trigger_pct")}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[var(--border-glass)]/70 bg-black/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Delta 2 (scalp account)
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d2-move`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Step move (%)
                  </label>
                  <input
                    id={`${baseId}-hs-d2-move`}
                    name="hs_d2_step_move_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta2StepMovePct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d2_step_move_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d2-qty`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Step qty (% of D1 qty)
                  </label>
                  <input
                    id={`${baseId}-hs-d2-qty`}
                    name="hs_d2_step_qty_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta2StepQtyPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d2_step_qty_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d2-tp`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Target profit (% per scalp)
                  </label>
                  <input
                    id={`${baseId}-hs-d2-tp`}
                    name="hs_d2_target_profit_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta2TargetProfitPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d2_target_profit_pct")}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-hs-d2-sl`}
                    className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    Stop loss (%)
                  </label>
                  <input
                    id={`${baseId}-hs-d2-sl`}
                    name="hs_d2_stop_loss_pct"
                    required
                    defaultValue={hedgeScalpingDefaults.delta2StopLossPct}
                    className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/40 focus:ring-2"
                  />
                  {fieldError(state.fieldErrors, "hs_d2_stop_loss_pct")}
                </div>
              </div>
            </div>
          </div>
        ) : null}

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
