"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { ZodIssue } from "zod";

import { formatUsdAmount } from "@/lib/format-inr";
import {
  createUserStrategyRunSettingsSchema,
  type UserStrategySettingsConstraints,
} from "@/lib/user-strategy-settings-schema";
import {
  updateUserStrategySettingsAction,
} from "@/server/actions/userStrategyRunSettings";
import {
  userStrategySettingsActionInitialState,
  type UserStrategySettingsActionState,
} from "@/server/actions/userStrategyRunSettings.state";
import type { HedgeScalpingConfig } from "@/lib/hedge-scalping-config";
import type { TrendProfitLockConfig } from "@/lib/trend-profit-lock-config";

import { GlassPanel } from "@/components/ui/GlassPanel";

/** Matches `hedge-scalping-config` default when `general.maxEntryDistanceFromSignalPct` is absent. */
const HS_MAX_ENTRY_DISTANCE_FALLBACK_PCT = 2.0;

function issuesToMap(issues: ZodIssue[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path[0];
    if (typeof k === "string" && m[k] == null) m[k] = i.message;
  }
  return m;
}

function toSafeString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v);
}

export function UserStrategySettingsForm({
  strategySlug = "",
  constraints,
  initialCapitalToUseInr,
  initialLeverage,
  initialPrimaryExchangeId = null,
  initialSecondaryExchangeId = null,
  deltaConnections = [],
  runStatus = "ready_to_activate",
  canEditSettings = false,
  isHedgeScalpingStrategy = false,
  hedgeScalpingAllowedSymbols = [],
  initialHedgeScalpingSymbol = null,
  hedgeScalpingResolvedConfig = null,
  isTrendProfitLockStrategy = false,
  trendProfitLockInitialConfig = null,
}: {
  strategySlug?: string;
  constraints?: UserStrategySettingsConstraints;
  initialCapitalToUseInr?: string;
  initialLeverage?: string;
  initialPrimaryExchangeId?: string | null;
  initialSecondaryExchangeId?: string | null;
  deltaConnections?: { id: string; accountLabel: string }[];
  runStatus?: string;
  canEditSettings?: boolean;
  isHedgeScalpingStrategy?: boolean;
  hedgeScalpingAllowedSymbols?: string[];
  initialHedgeScalpingSymbol?: string | null;
  /** Merged with defaults on the server; safe for legacy `settings_json`. */
  hedgeScalpingResolvedConfig?: HedgeScalpingConfig | null;
  isTrendProfitLockStrategy?: boolean;
  trendProfitLockInitialConfig?: TrendProfitLockConfig | null;
}) {
  const initialCapitalSafe = toSafeString(initialCapitalToUseInr);
  const initialLeverageSafe = toSafeString(initialLeverage);

  const safeConstraints = useMemo<UserStrategySettingsConstraints>(
    () => ({
      recommendedCapitalInr: constraints?.recommendedCapitalInr ?? null,
      maxLeverage: constraints?.maxLeverage ?? null,
    }),
    [constraints?.recommendedCapitalInr, constraints?.maxLeverage],
  );

  const schema = useMemo(
    () => createUserStrategyRunSettingsSchema(safeConstraints),
    [safeConstraints],
  );

  const maxLevNum = useMemo(() => {
    const s = safeConstraints.maxLeverage;
    if (s == null || String(s).trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }, [safeConstraints.maxLeverage]);

  const [capital, setCapital] = useState(initialCapitalSafe);
  const [leverage, setLeverage] = useState(initialLeverageSafe);
  const [liveErrors, setLiveErrors] = useState<Record<string, string>>({});

  const [state, formAction, pending] = useActionState<
    UserStrategySettingsActionState,
    FormData
  >(updateUserStrategySettingsAction, userStrategySettingsActionInitialState);

  useEffect(() => {
    const r = schema.safeParse({
      capitalToUseInr: capital ?? "",
      leverage: leverage ?? "",
    });
    if (!r.success) {
      setLiveErrors(issuesToMap(r.error.issues));
    } else {
      setLiveErrors({});
    }
  }, [capital, leverage, schema]);

  const fieldErrors = state.fieldErrors ?? {};
  const tplError = (key: string) => fieldErrors[key];
  const capitalErr =
    liveErrors.capitalToUseInr ?? fieldErrors.capitalToUseInr;
  const leverageErr = liveErrors.leverage ?? fieldErrors.leverage;

  const sliderMin = 0.01;
  const sliderMax = maxLevNum ?? 1;
  const levNum = Number(leverage);
  const sliderValue =
    Number.isFinite(levNum) && levNum > 0
      ? Math.min(Math.max(levNum, sliderMin), sliderMax)
      : sliderMin;

  function setLeverageFromSlider(v: number) {
    setLeverage(String(Math.round(v * 100) / 100));
  }

  if (!canEditSettings) {
    return (
      <GlassPanel className="border border-amber-500/25 bg-amber-500/5">
        <p className="text-sm text-amber-100">
          Capital and leverage cannot be edited while the run is in the
          &quot;{runStatus}&quot; state. Use My strategies to activate or resolve
          blocks first.
        </p>
      </GlassPanel>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="strategySlug" value={strategySlug} />

      <GlassPanel className="border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Strategy constraints
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2">
            <dt className="text-[var(--text-muted)]">Recommended capital (min, USD)</dt>
            <dd className="mt-1 font-medium text-[var(--text-primary)]">
              {safeConstraints.recommendedCapitalInr
                ? formatUsdAmount(safeConstraints.recommendedCapitalInr)
                : "Not set — any positive capital amount is allowed."}
            </dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2">
            <dt className="text-[var(--text-muted)]">Max leverage</dt>
            <dd className="mt-1 font-medium text-[var(--text-primary)]">
              {maxLevNum != null ? `${maxLevNum}×` : "Not configured"}
            </dd>
          </div>
        </dl>
        {maxLevNum == null ? (
          <p className="mt-3 text-sm text-amber-100/95">
            Leverage cannot be saved until an admin sets max leverage for this
            strategy. You can still update capital.
          </p>
        ) : null}
      </GlassPanel>

      {isHedgeScalpingStrategy && hedgeScalpingAllowedSymbols.length > 0 ? (
        <GlassPanel className="space-y-3 border border-white/[0.08]">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Hedge scalping · instrument
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Choose which listed contract this run follows. Your selection is saved on this
            strategy run for the trading worker.
          </p>
          <div>
            <label
              htmlFor="hedge_scalping_symbol"
              className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Symbol
            </label>
            <select
              id="hedge_scalping_symbol"
              name="hedge_scalping_symbol"
              required
              defaultValue={
                initialHedgeScalpingSymbol && hedgeScalpingAllowedSymbols.includes(initialHedgeScalpingSymbol)
                  ? initialHedgeScalpingSymbol
                  : hedgeScalpingAllowedSymbols[0]
              }
              disabled={pending}
              className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            >
              {hedgeScalpingAllowedSymbols.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
            {fieldErrors.hedge_scalping_symbol ? (
              <p className="mt-1 text-sm text-amber-200" role="alert">
                {fieldErrors.hedge_scalping_symbol}
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
              HalfTrend entry-distance guard (strategy default):{" "}
              <span className="font-mono text-slate-200">
                {(
                  hedgeScalpingResolvedConfig?.general?.maxEntryDistanceFromSignalPct ??
                  HS_MAX_ENTRY_DISTANCE_FALLBACK_PCT
                ).toFixed(2)}
                %
              </span>
              . Paper{" "}
              <code className="text-[10px] text-sky-300/90">NEW_RUN</code> entries are skipped when
              the signal candle is farther than this from the HalfTrend baseline.
            </p>
          </div>
        </GlassPanel>
      ) : null}

      {isTrendProfitLockStrategy && trendProfitLockInitialConfig ? (
        <GlassPanel className="space-y-4 border border-white/[0.08]">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Trend Profit Lock Scalping
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Configure your run-level D1 and D2 parameters. Guardrails: D2 triggers must be
            strictly increasing, and combined D2 quantity cannot exceed 100% of D1.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Timeframe
              </label>
              <select
                name="tpl_timeframe"
                defaultValue={trendProfitLockInitialConfig.timeframe}
                disabled={pending}
                className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
              >
                <option value="1m">1m</option>
                <option value="3m">3m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="30m">30m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
              </select>
              {tplError("tpl_timeframe") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_timeframe")}</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                HalfTrend amplitude
              </label>
              <input name="tpl_halftrend_amplitude" defaultValue={trendProfitLockInitialConfig.halftrendAmplitude} disabled={pending} className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />
              {tplError("tpl_halftrend_amplitude") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_halftrend_amplitude")}</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                D1 capital allocation (%)
              </label>
              <input name="tpl_d1_capital_allocation_pct" defaultValue={trendProfitLockInitialConfig.d1CapitalAllocationPct} disabled={pending} className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />
              {tplError("tpl_d1_capital_allocation_pct") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_d1_capital_allocation_pct")}</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                D1 target (%)
              </label>
              <input name="tpl_d1_target_pct" defaultValue={trendProfitLockInitialConfig.d1TargetPct} disabled={pending} className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />
              {tplError("tpl_d1_target_pct") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_d1_target_pct")}</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                D1 stoploss (%)
              </label>
              <input name="tpl_d1_stoploss_pct" defaultValue={trendProfitLockInitialConfig.d1StoplossPct} disabled={pending} className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />
              {tplError("tpl_d1_stoploss_pct") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_d1_stoploss_pct")}</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                D1 breakeven trigger (%)
              </label>
              <input name="tpl_d1_breakeven_trigger_pct" defaultValue={trendProfitLockInitialConfig.d1BreakevenTriggerPct} disabled={pending} className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />
              {tplError("tpl_d1_breakeven_trigger_pct") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_d1_breakeven_trigger_pct")}</p>
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Symbol
              </label>
              <input name="tpl_symbol" defaultValue={trendProfitLockInitialConfig.symbol} disabled={pending} className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />
              {tplError("tpl_symbol") ? (
                <p className="mt-1 text-sm text-amber-200">{tplError("tpl_symbol")}</p>
              ) : null}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-white/[0.1]">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-black/40 text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Step</th>
                  <th className="px-3 py-2">Trigger %</th>
                  <th className="px-3 py-2">Qty % of D1</th>
                  <th className="px-3 py-2">Target %</th>
                  <th className="px-3 py-2">Stoploss %</th>
                </tr>
              </thead>
              <tbody>
                {trendProfitLockInitialConfig.d2Steps.map((step) => (
                  <tr key={step.step} className="border-t border-white/[0.06]">
                    <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{step.step}</td>
                    <td className="px-3 py-2"><input name={`tpl_d2_step_${step.step}_trigger_pct`} defaultValue={String(step.stepTriggerPct)} disabled={pending} className="w-full rounded-md border border-white/[0.12] bg-black/30 px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />{tplError(`tpl_d2_step_${step.step}_trigger_pct`) ? <p className="mt-1 text-[10px] text-amber-200">{tplError(`tpl_d2_step_${step.step}_trigger_pct`)}</p> : null}</td>
                    <td className="px-3 py-2"><input name={`tpl_d2_step_${step.step}_qty_pct_of_d1`} defaultValue={String(step.stepQtyPctOfD1)} disabled={pending} className="w-full rounded-md border border-white/[0.12] bg-black/30 px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />{tplError(`tpl_d2_step_${step.step}_qty_pct_of_d1`) ? <p className="mt-1 text-[10px] text-amber-200">{tplError(`tpl_d2_step_${step.step}_qty_pct_of_d1`)}</p> : null}</td>
                    <td className="px-3 py-2"><input name={`tpl_d2_step_${step.step}_target_pct`} defaultValue={String(step.stepTargetPct)} disabled={pending} className="w-full rounded-md border border-white/[0.12] bg-black/30 px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />{tplError(`tpl_d2_step_${step.step}_target_pct`) ? <p className="mt-1 text-[10px] text-amber-200">{tplError(`tpl_d2_step_${step.step}_target_pct`)}</p> : null}</td>
                    <td className="px-3 py-2"><input name={`tpl_d2_step_${step.step}_stoploss_pct`} defaultValue={String(step.stepStoplossPct)} disabled={pending} className="w-full rounded-md border border-white/[0.12] bg-black/30 px-2 py-1 text-xs text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50" />{tplError(`tpl_d2_step_${step.step}_stoploss_pct`) ? <p className="mt-1 text-[10px] text-amber-200">{tplError(`tpl_d2_step_${step.step}_stoploss_pct`)}</p> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fieldErrors.tpl_d2_total_allocation ? (
            <p className="text-sm text-amber-200" role="alert">
              {fieldErrors.tpl_d2_total_allocation}
            </p>
          ) : null}
          {fieldErrors.tpl_trend_profit_lock ? (
            <p className="text-sm text-amber-200" role="alert">
              {fieldErrors.tpl_trend_profit_lock}
            </p>
          ) : null}
        </GlassPanel>
      ) : null}

      {runStatus === "active" ? (
        <p className="text-sm text-sky-200/90">
          New settings will apply to future trades only.
        </p>
      ) : null}

      <GlassPanel className="space-y-4 border border-white/[0.08]">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Delta venues (multi-account)
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Pick which saved Delta API profile is <strong className="text-[var(--text-primary)]">primary</strong>{" "}
          (default for broadcast signals) and an optional{" "}
          <strong className="text-[var(--text-primary)]">secondary</strong> for hedging / arb
          workers. Manage keys on{" "}
          <a href="/user/exchange" className="text-[var(--accent)] underline">
            Exchange
          </a>
          .
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="primary_exchange_connection_id"
              className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Primary (Delta 1)
            </label>
            <select
              id="primary_exchange_connection_id"
              name="primary_exchange_connection_id"
              defaultValue={initialPrimaryExchangeId ?? ""}
              disabled={pending || deltaConnections.length === 0}
              className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            >
              <option value="">— Auto (latest tested profile) —</option>
              {deltaConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.accountLabel}
                </option>
              ))}
            </select>
            {fieldErrors.primary_exchange_connection_id ? (
              <p className="mt-1 text-sm text-amber-200" role="alert">
                {fieldErrors.primary_exchange_connection_id}
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="secondary_exchange_connection_id"
              className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
            >
              Secondary (Delta 2)
            </label>
            <select
              id="secondary_exchange_connection_id"
              name="secondary_exchange_connection_id"
              defaultValue={initialSecondaryExchangeId ?? ""}
              disabled={pending || deltaConnections.length === 0}
              className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            >
              <option value="">— None —</option>
              {deltaConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.accountLabel}
                </option>
              ))}
            </select>
            {fieldErrors.secondary_exchange_connection_id ? (
              <p className="mt-1 text-sm text-amber-200" role="alert">
                {fieldErrors.secondary_exchange_connection_id}
              </p>
            ) : null}
          </div>
        </div>
        {deltaConnections.length === 0 ? (
          <p className="text-xs text-amber-100/90">
            Save at least one Delta profile under Exchange before you can pin primary /
            secondary here.
          </p>
        ) : null}
      </GlassPanel>

      <GlassPanel className="space-y-4 border border-white/[0.08]">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Your capital allocation & leverage
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
            <strong className="text-[var(--text-primary)]">Allocated capital (USD)</strong> and{" "}
            <strong className="text-[var(--text-primary)]">leverage</strong> are saved on your strategy
            run and used to size Delta orders (contract count from collateral × leverage ÷ contract
            value). Strategy defaults are only fallbacks when you leave a field unset; the catalog
            minimum and max leverage still apply as guardrails.
          </p>
        </div>
        <div>
          <label
            htmlFor="capitalToUseInr"
            className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Allocated capital (USD)
          </label>
          <input
            id="capitalToUseInr"
            name="capitalToUseInr"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            disabled={pending}
            inputMode="decimal"
            autoComplete="off"
            className="form-touch mt-1 w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            placeholder={
              safeConstraints.recommendedCapitalInr
                ? `e.g. ${safeConstraints.recommendedCapitalInr}`
                : "Amount in USD"
            }
          />
          {capitalErr ? (
            <p className="mt-1 text-sm text-amber-200" role="alert">
              {capitalErr}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
            Optional advanced override: <code className="text-sky-300/90">run_settings_json.execution.allocatedCapitalUsd</code>{" "}
            or <code className="text-sky-300/90">capitalPercentage</code> (0–100 of the strategy
            recommended amount) if you manage runs via API.
          </p>
        </div>

        <div className={maxLevNum == null ? "opacity-60" : ""}>
          <label
            htmlFor="leverage"
            className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
          >
            Leverage (×)
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-h-11 w-full flex-1 items-center py-1 sm:max-w-md">
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={0.01}
              value={sliderValue}
              disabled={pending || maxLevNum == null}
              onChange={(e) =>
                setLeverageFromSlider(Number.parseFloat(e.target.value))
              }
              className="h-11 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
              aria-label="Leverage slider"
            />
            </div>
            <input
              id="leverage"
              name="leverage"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              disabled={pending || maxLevNum == null}
              inputMode="decimal"
              autoComplete="off"
              className="form-touch w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 text-[var(--text-primary)] outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50 sm:w-32"
            />
          </div>
          {leverageErr ? (
            <p className="mt-1 text-sm text-amber-200" role="alert">
              {leverageErr}
            </p>
          ) : null}
        </div>
      </GlassPanel>

      {state.message ? (
        <p
          role="status"
          className={
            state.ok === true
              ? "text-sm text-emerald-200"
              : state.ok === false
                ? "text-sm text-amber-200"
                : "text-sm text-[var(--text-muted)]"
          }
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || Object.keys(liveErrors).length > 0}
        className="btn-primary disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
