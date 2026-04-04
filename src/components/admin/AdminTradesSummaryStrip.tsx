import { formatInrAmount, formatUsdAmount } from "@/lib/format-inr";
import type { AdminTradeLedgerSummary } from "@/server/queries/admin-trades-ledger";

export function AdminTradesSummaryStrip({
  summary,
}: {
  summary: AdminTradeLedgerSummary;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--border-glass)] bg-white/[0.03] px-4 py-3 backdrop-blur-sm">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Filtered net PnL (USD)
        </p>
        <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-[var(--text-primary)]">
          {formatUsdAmount(summary.totalNetPnlInr)}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          Sum of realized PnL in the current result set (trading, USD)
        </p>
      </div>
      <div className="rounded-xl border border-[var(--border-glass)] bg-white/[0.03] px-4 py-3 backdrop-blur-sm">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Filtered revenue share (INR)
        </p>
        <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-sky-300/90">
          {formatInrAmount(summary.totalRevenueShareInr)}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          Estimated platform rev share on filtered rows (billing, INR)
        </p>
      </div>
      <div className="rounded-xl border border-[var(--border-glass)] bg-white/[0.03] px-4 py-3 backdrop-blur-sm">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Execution success rate
        </p>
        <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-emerald-300/90">
          {summary.executionSuccessRatePct}%
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          Bot failures (failed/rejected) vs all rows; manual trades count as success
        </p>
      </div>
    </div>
  );
}
