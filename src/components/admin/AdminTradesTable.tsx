import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { TableScroll } from "@/components/ui/TableScroll";
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

function whenIst(sortTs: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(sortTs));
}

function AdminTradeMobileCard({ r }: { r: AdminTradeLedgerRow }) {
  const b = BADGE[r.statusBadge];
  const pnl = r.netPnlInr != null ? Number(r.netPnlInr) : NaN;
  const pnlCls =
    Number.isFinite(pnl) && pnl > 0
      ? "text-emerald-300"
      : Number.isFinite(pnl) && pnl < 0
        ? "text-red-300"
        : "text-[var(--text-muted)]";

  return (
    <div className="rounded-2xl border border-[var(--border-glass)] bg-black/30 p-4 shadow-[0_0_0_1px_rgba(56,189,248,0.06)] backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-[var(--accent)]">{r.symbol}</p>
          <p className="text-xs text-[var(--text-muted)]">{r.strategyName}</p>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">{whenIst(r.sortTs)} IST</p>
        </div>
        <span
          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${b.className}`}
        >
          {b.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">User</p>
          <p className="truncate font-medium text-[var(--text-primary)]" title={r.userEmail}>
            {r.userEmail}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Side</p>
          <p className="font-medium capitalize text-[var(--text-primary)]">{r.side}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Qty</p>
          <p className="font-mono tabular-nums text-[var(--text-primary)]">{r.quantity}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Net PnL</p>
          <p className={`tabular-nums font-medium ${pnlCls}`}>
            {r.netPnlInr != null ? formatInrAmount(r.netPnlInr) : "—"}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-[var(--text-muted)]">Rev share fee</p>
          <p className="tabular-nums text-sky-200/90">{formatInrAmount(r.revenueShareFeeInr)}</p>
        </div>
      </div>
    </div>
  );
}

export function AdminTradesTable({ rows }: { rows: AdminTradeLedgerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No trades for this period"
        description="Try widening the IST date range or clearing filters to see more activity."
        action={
          <Link href="/admin/trades" className="btn-secondary inline-flex">
            Reset filters
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="md:hidden space-y-3">
        {rows.map((r) => (
          <AdminTradeMobileCard key={`${r.ledgerKind}-${r.ledgerId}`} r={r} />
        ))}
      </div>

      <div className="hidden md:block">
        <TableScroll>
          <table className="table-sticky-first w-full min-w-[1200px] border-collapse text-left text-[11px] sm:text-xs">
            <thead>
              <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="whitespace-nowrap pb-2 pr-2 pl-2 font-medium">When</th>
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
                <th className="pb-2 pr-2 font-medium">Status</th>
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
                    <td className="whitespace-nowrap py-1.5 pr-2 pl-2 align-top text-[var(--text-muted)]">
                      {whenIst(r.sortTs)}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <div className="max-w-[140px] truncate font-medium" title={r.userEmail}>
                        {r.userEmail}
                      </div>
                      <div className="truncate text-[10px] text-[var(--text-muted)]">
                        {r.userName ?? "—"}
                      </div>
                    </td>
                    <td
                      className="max-w-[100px] py-1.5 pr-2 align-top truncate"
                      title={r.strategyName}
                    >
                      {r.strategyName}
                    </td>
                    <td className="py-1.5 pr-2 align-top font-mono text-[10px]">{r.symbol}</td>
                    <td className="py-1.5 pr-2 align-top uppercase">{r.side}</td>
                    <td className="py-1.5 pr-2 align-top font-mono text-[10px] tabular-nums">
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
                    <td
                      className="max-w-[120px] py-1.5 pr-2 align-top truncate font-mono text-[10px] text-[var(--text-muted)]"
                      title={r.venueOrderId ?? ""}
                    >
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
        </TableScroll>
      </div>
    </>
  );
}
