import Link from "next/link";
import { notFound } from "next/navigation";

import { StrategyPerformanceChartPreview } from "@/components/admin/StrategyPerformanceChartPreview";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount, formatUsdAmount } from "@/lib/format-inr";
import { validatePerformanceChartPayload } from "@/lib/strategy-performance-chart";
import { getAdminStrategyDetail } from "@/server/queries/admin-strategies";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const data = await getAdminStrategyDetail(id);
  return { title: data ? data.strategy.name : "Strategy" };
}

const VIS: Record<string, string> = {
  public: "Public",
  hidden: "Hidden",
};

const ST: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  hidden: "Hidden (legacy)",
  archived: "Archived",
};

const RISK: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export default async function AdminStrategyDetailPage({ params }: Props) {
  const { id } = await params;
  const data = await getAdminStrategyDetail(id);
  if (!data) {
    notFound();
  }

  const { strategy, subscriptionActiveCount, subscriptionTotalCount, recentSnapshots } =
    data;

  const chartParsed = validatePerformanceChartPayload(
    strategy.performanceChartJson,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/strategies"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Strategies
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          {strategy.name}
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--accent)]">{strategy.slug}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/admin/strategies/${id}/edit`}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90"
        >
          Edit
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassPanel className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Overview
          </h2>
          <dl className="grid gap-3 text-sm text-[var(--text-muted)]">
            <div>
              <dt className="text-xs uppercase text-slate-500">Visibility</dt>
              <dd className="text-[var(--text-primary)]">
                {VIS[strategy.visibility] ?? strategy.visibility}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Status</dt>
              <dd className="text-[var(--text-primary)]">
                {ST[strategy.status] ?? strategy.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Risk</dt>
              <dd className="text-[var(--text-primary)]">
                {RISK[strategy.riskLabel] ?? strategy.riskLabel}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Default fee / rev.</dt>
              <dd className="text-[var(--text-primary)]">
                {formatInrAmount(strategy.defaultMonthlyFeeInr)} / mo ·{" "}
                {strategy.defaultRevenueSharePercent}% revenue share
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Capital (USD) / leverage</dt>
              <dd className="text-[var(--text-primary)]">
                {strategy.recommendedCapitalInr
                  ? formatUsdAmount(strategy.recommendedCapitalInr)
                  : "—"}{" "}
                · max lev. {strategy.maxLeverage ?? "—"}
              </dd>
            </div>
          </dl>
          {strategy.description ? (
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              {strategy.description}
            </p>
          ) : null}
          {strategy.status === "hidden" ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Legacy <code>status = hidden</code> — migrate via Edit (set visibility +
              active/paused).
            </p>
          ) : null}
        </GlassPanel>

        <GlassPanel className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Subscriptions
          </h2>
          <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">
            {subscriptionActiveCount}{" "}
            <span className="text-lg font-normal text-[var(--text-muted)]">
              active
            </span>
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            <span className="text-[var(--text-primary)]">
              {subscriptionTotalCount}
            </span>{" "}
            total rows (non-deleted subscriptions). Active = status{" "}
            <code className="text-xs text-slate-400">active</code> and{" "}
            <code className="text-xs text-slate-400">access_valid_until</code>{" "}
            after now (UTC clock).
          </p>
        </GlassPanel>
      </div>

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Performance chart (JSON)
        </h2>
        {!chartParsed.ok ? (
          <p className="text-sm text-amber-200/90">
            Stored chart JSON is invalid: {chartParsed.error}
          </p>
        ) : (
          <StrategyPerformanceChartPreview points={chartParsed.points} />
        )}
      </GlassPanel>

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Recent performance snapshots
        </h2>
        {recentSnapshots.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No rows in <code className="text-xs">strategy_performance_snapshots</code>.
          </p>
        ) : (
          <ul className="space-y-2 text-xs text-[var(--text-muted)]">
            {recentSnapshots.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-[var(--border-glass)] bg-black/20 px-3 py-2"
              >
                <span className="text-[var(--text-primary)]">
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  }).format(s.capturedAt)}{" "}
                  IST
                </span>
                {" · "}
                equity (USD){" "}
                {s.metricEquityInr != null ? formatUsdAmount(s.metricEquityInr) : "—"}
                {" · "}
                return {s.metricReturnPct != null ? `${s.metricReturnPct}%` : "—"}
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
