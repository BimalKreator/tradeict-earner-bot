import { formatInrAmount } from "@/lib/format-inr";
import type { AdminTradeLedgerRow } from "@/server/queries/admin-trades-ledger";

const BADGE: Record<
  AdminTradeLedgerRow["statusBadge"],
  { label: string; className: string }
> = {
  filled: {
    label: "Filled",
    className: "bg-emerald-500/20 text-emerald-200",
  },
  partial_fill: {
    label: "Partial",
    className: "bg-cyan-500/20 text-cyan-200",
  },
  open: {
    label: "Open",
    className: "bg-slate-500/25 text-slate-200",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-amber-500/20 text-amber-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/25 text-red-200",
  },
};

export function AdminTradesTable({ rows }: { rows: AdminTradeLedgerRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No rows match filters.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1200px] border-collapse text-left text-[11px] sm:text-xs">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-2 pr-2 font-medium">When</th>
            <th className="pb-2 pr-2 font-medium">User</th>
            <th className="pb-2 pr-2 font-medium">Strategy</th>
            <th className="pb-2 pr-2 font-medium">Sym</th>
            <th className="pb-2 pr-2 font-medium">Side</th>
            <th className="pb-2 pr-2 font-medium">Qty</th>
            <th className="pb-2 pr-2 font-medium">Entry</th>
            <th className="pb-2 pr-2 font-medium">Exit</th>
            <th className="pb-2 pr-2 font-medium">PnL</th>
            <th className="pb-2 pr-2 font-medium">Rev %</th>
            <th className="pb-2 pr-2 font-medium">Venue ID</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = BADGE[r.statusBadge];
            return (
              <tr
                key={`${r.ledgerKind}-${r.ledgerId}`}
                className="border-b border-[var(--border-glass)]/50 text-[var(--text-primary)]"
              >
                <td className="py-1.5 pr-2 align-top text-[var(--text-muted)] whitespace-nowrap">
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  }).format(new Date(r.sortTs))}
                </td>
                <td className="py-1.5 pr-2 align-top">
                  <div className="max-w-[140px] truncate font-medium" title={r.userEmail}>
                    {r.userEmail}
                  </div>
                  <div className="truncate text-[10px] text-[var(--text-muted)]">
                    {r.userName ?? "—"}
                  </div>
                </td>
                <td className="max-w-[100px] py-1.5 pr-2 align-top truncate" title={r.strategyName}>
                  {r.strategyName}
                </td>
                <td className="py-1.5 pr-2 align-top font-mono text-[10px]">{r.symbol}</td>
                <td className="py-1.5 pr-2 align-top uppercase">{r.side}</td>
                <td className="py-1.5 pr-2 align-top tabular-nums font-mono text-[10px]">
                  {r.quantity}
                </td>
                <td className="py-1.5 pr-2 align-top tabular-nums text-[var(--text-muted)]">
                  {r.entryPrice ?? "—"}
                </td>
                <td className="py-1.5 pr-2 align-top tabular-nums text-[var(--text-muted)]">
                  {r.exitPrice ?? "—"}
                </td>
                <td className="py-1.5 pr-2 align-top tabular-nums">
                  {r.netPnlInr != null ? formatInrAmount(r.netPnlInr) : "—"}
                </td>
                <td className="py-1.5 pr-2 align-top tabular-nums text-sky-300/80">
                  {formatInrAmount(r.revenueShareFeeInr)}
                </td>
                <td className="max-w-[120px] py-1.5 pr-2 align-top font-mono text-[10px] text-[var(--text-muted)] truncate" title={r.venueOrderId ?? ""}>
                  {r.venueOrderId ?? "—"}
                </td>
                <td className="py-1.5 align-top">
                  <span
                    className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${b.className}`}
                  >
                    {b.label}
                  </span>
                  {r.sourceTag === "manual" ? (
                    <span className="ml-1 text-[10px] text-[var(--text-muted)]">manual</span>
                  ) : r.retryCount > 0 ? (
                    <span className="ml-1 text-[10px] text-amber-400/90" title="Retries">
                      r{r.retryCount}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
