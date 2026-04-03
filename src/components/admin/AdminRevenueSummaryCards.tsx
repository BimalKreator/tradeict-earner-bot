import { formatInrAmount } from "@/lib/format-inr";
import type { AdminRevenueSummary } from "@/server/queries/admin-revenue";

type Props = { summary: AdminRevenueSummary };

export function AdminRevenueSummaryCards({ summary }: Props) {
  const cards = [
    {
      label: "Ledger book (due)",
      value: formatInrAmount(summary.totalLedgerDueInr),
      hint: "Sum of amount_due on ledgers in scope",
    },
    {
      label: "Payments collected",
      value: formatInrAmount(summary.totalPaymentsCollectedInr),
      hint: "Successful gateway payments (IST week filter applies to payment time)",
    },
    {
      label: "Applied on ledgers",
      value: formatInrAmount(summary.totalLedgerPaidInr),
      hint: "Sum of amount_paid on revenue ledgers",
    },
    {
      label: "Outstanding (net due)",
      value: formatInrAmount(summary.totalOutstandingInr),
      hint: "Unpaid + partial rows: max(0, due − paid)",
    },
    {
      label: "Waivers recorded",
      value: formatInrAmount(summary.totalWaivedInr),
      hint: "Sum of fee_waivers.amount_inr on revenue ledgers",
    },
    {
      label: "Subscription vs rev-share",
      value: (
        <span className="block text-sm leading-snug">
          <span className="text-[var(--text-primary)]">
            Sub: {formatInrAmount(summary.subscriptionFeesCollectedInr)}
          </span>
          <span className="mx-1 text-[var(--text-muted)]">·</span>
          <span className="text-[var(--text-primary)]">
            RS: {formatInrAmount(summary.revenueShareCollectedInr)}
          </span>
        </span>
      ),
      hint: "Successful payments split by revenue_share_ledger_id",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-[var(--border-glass)] bg-white/[0.03] px-4 py-3 backdrop-blur-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {c.label}
          </p>
          <div className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-[var(--text-primary)]">
            {c.value}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {c.hint}
          </p>
        </div>
      ))}
      <div className="rounded-xl border border-[var(--border-glass)] bg-white/[0.03] px-4 py-3 backdrop-blur-sm sm:col-span-2 xl:col-span-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Ledger rows in scope · users blocked for revenue
        </p>
        <p className="mt-1 text-sm text-[var(--text-primary)]">
          <span className="font-semibold tabular-nums">{summary.ledgerRowCount}</span>
          <span className="mx-2 text-[var(--text-muted)]">·</span>
          <span className="text-[var(--text-muted)]">Blocked (runs):</span>{" "}
          <span className="font-semibold tabular-nums text-amber-400/90">
            {summary.usersBlockedRevenueCount}
          </span>
        </p>
      </div>
    </div>
  );
}
