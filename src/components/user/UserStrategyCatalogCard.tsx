import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount, formatUsdAmount } from "@/lib/format-inr";
import type { UserStrategyCardModel } from "@/server/queries/user-strategy-catalog";

import { UserStrategySparkline } from "./UserStrategySparkline";

function riskStyles(label: string): { badge: string; dot: string } {
  switch (label) {
    case "low":
      return {
        badge: "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-500/30",
        dot: "bg-emerald-400",
      };
    case "high":
      return {
        badge: "bg-red-500/15 text-red-100 ring-1 ring-red-500/35",
        dot: "bg-red-400",
      };
    default:
      return {
        badge: "bg-amber-500/15 text-amber-100 ring-1 ring-amber-500/35",
        dot: "bg-amber-400",
      };
  }
}

export function UserStrategyCatalogCard({ strategy }: { strategy: UserStrategyCardModel }) {
  const risk = riskStyles(strategy.riskLabel);
  const checkoutHref = `/user/strategies/${encodeURIComponent(strategy.slug)}/checkout`;

  return (
    <GlassPanel className="flex h-full flex-col overflow-hidden border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
              {strategy.name}
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${risk.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${risk.dot}`} aria-hidden />
              {strategy.riskLabel} risk
            </span>
          </div>
          {strategy.description ? (
            <p className="text-sm leading-relaxed text-[var(--text-muted)] line-clamp-3">
              {strategy.description}
            </p>
          ) : (
            <p className="text-sm italic text-[var(--text-muted)]/70">
              No description yet.
            </p>
          )}
        </div>

        <UserStrategySparkline slug={strategy.slug} data={strategy.performanceChartJson} />

        <div className="space-y-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Monthly fee (INR)
              </p>
              <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                {formatInrAmount(strategy.monthlyFeeInr)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Revenue share
              </p>
              <p className="text-lg font-semibold tabular-nums text-sky-200/90">
                {strategy.revenueSharePercent}%
              </p>
            </div>
          </div>
          {strategy.hasPricingOverride ? (
            <span className="inline-block rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
              Overridden for your account
            </span>
          ) : null}
        </div>

        {strategy.recommendedCapitalInr ? (
          <p className="text-xs text-[var(--text-muted)]">
            <span className="text-[var(--text-primary)]">Recommended capital (USD):</span>{" "}
            {formatUsdAmount(strategy.recommendedCapitalInr)}
          </p>
        ) : null}

        <div className="mt-auto pt-1">
          {strategy.subscriptionUx === "subscribed" ? (
            <span className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-100">
              Subscribed
            </span>
          ) : strategy.subscriptionUx === "pending_activation" ? (
            <span className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/35 bg-amber-500/10 py-2.5 text-sm font-medium text-amber-100">
              Pending activation
            </span>
          ) : (
            <Link
              href={checkoutHref}
              className="flex w-full items-center justify-center rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/10 transition hover:opacity-95"
            >
              Subscribe
            </Link>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
