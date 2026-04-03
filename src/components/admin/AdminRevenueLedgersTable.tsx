import { formatInrAmount } from "@/lib/format-inr";

export type AdminLedgerRow = {
  id: string;
  userEmail: string;
  strategyName: string;
  weekStartDateIst: string;
  weekEndDateIst: string;
  amountDueInr: string;
  amountPaidInr: string;
  status: string;
};

const LEDGER_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  waived: "Waived",
};

export function AdminRevenueLedgersTable({ rows }: { rows: AdminLedgerRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No weekly revenue share ledger rows yet. Entries appear once billing and
        bot PnL jobs populate this table.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-3 pr-4 font-medium">Week (IST)</th>
            <th className="pb-3 pr-4 font-medium">User</th>
            <th className="pb-3 pr-4 font-medium">Strategy</th>
            <th className="pb-3 pr-4 font-medium">Due</th>
            <th className="pb-3 pr-4 font-medium">Paid</th>
            <th className="pb-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
            >
              <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
                {r.weekStartDateIst} → {r.weekEndDateIst}
              </td>
              <td className="py-3 pr-4 align-top">{r.userEmail}</td>
              <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
                {r.strategyName}
              </td>
              <td className="py-3 pr-4 align-top tabular-nums">
                {formatInrAmount(r.amountDueInr)}
              </td>
              <td className="py-3 pr-4 align-top tabular-nums text-[var(--text-muted)]">
                {formatInrAmount(r.amountPaidInr)}
              </td>
              <td className="py-3 align-top">
                <span className="rounded-lg bg-white/5 px-2 py-0.5 text-xs text-[var(--text-muted)]">
                  {LEDGER_STATUS_LABELS[r.status] ?? r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
