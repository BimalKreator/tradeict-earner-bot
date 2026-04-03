import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount } from "@/lib/format-inr";
import { transactionsPageHref } from "@/lib/user-transactions-url";
import type {
  StrategyFilterOption,
  TransactionLedgerFilters,
  TransactionLedgerResult,
  TransactionLedgerRow,
} from "@/server/queries/user-transactions-ledger";

function istShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case "open":
      return "border-sky-500/35 bg-sky-500/10 text-sky-200";
    case "filled":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    case "failed":
      return "border-red-500/40 bg-red-500/10 text-red-200";
    case "closed":
      return "border-white/15 bg-black/30 text-[var(--text-muted)]";
    default:
      return "border-[var(--border-glass)] bg-black/25 text-[var(--text-muted)]";
  }
}

function LedgerRowCard({ row }: { row: TransactionLedgerRow }) {
  const pnl = row.netPnlInr != null ? Number(row.netPnlInr) : NaN;
  const pnlClass =
    Number.isFinite(pnl) && pnl > 0
      ? "text-emerald-400"
      : Number.isFinite(pnl) && pnl < 0
        ? "text-red-400"
        : "text-[var(--text-muted)]";
  const sideClass =
    row.side === "buy" ? "text-emerald-400" : "text-red-400";

  return (
    <div className="rounded-xl border border-[var(--border-glass)] bg-black/25 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-[var(--accent)]">
            {row.symbol}
          </p>
          <p className="text-xs text-[var(--text-muted)]">{row.strategyName}</p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(row.uiStatus)}`}
        >
          {row.uiStatus}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">Tag</p>
          <p className="text-[var(--text-primary)]">
            {row.sourceTag === "bot" ? "Bot trade" : "Manual"}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Side</p>
          <p className={`font-medium capitalize ${sideClass}`}>{row.side}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Entry (IST)</p>
          <p className="text-[var(--text-primary)]">{istShort(row.entryTime)}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Exit (IST)</p>
          <p className="text-[var(--text-primary)]">{istShort(row.exitTime)}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Qty</p>
          <p className="tabular-nums text-[var(--text-primary)]">{row.quantity}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Net PnL</p>
          <p className={`tabular-nums font-medium ${pnlClass}`}>
            {row.netPnlInr != null ? formatInrAmount(row.netPnlInr) : "—"}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-[var(--text-muted)]">Rev share fee</p>
          <p className="tabular-nums text-[var(--text-primary)]">
            {formatInrAmount(row.revenueShareFeeInr)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function UserTransactionsView({
  data,
  filters,
  strategyOptions,
}: {
  data: TransactionLedgerResult;
  filters: TransactionLedgerFilters;
  strategyOptions: StrategyFilterOption[];
}) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const mkPage = (p: number) => {
    const next = { ...filters, page: p };
    return transactionsPageHref(next);
  };

  return (
    <div className="space-y-6">
      <GlassPanel className="!border-[var(--accent)]/25 !bg-gradient-to-br from-black/40 to-slate-950/40 !p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Filtered totals ({data.total} row{data.total === 1 ? "" : "s"})
        </p>
        <div className="mt-3 flex flex-wrap gap-8">
          <div>
            <p className="text-xs text-[var(--text-muted)]">Net PnL</p>
            <p
              className={`font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums ${
                Number(data.summaryNetPnlInr) >= 0
                  ? "text-emerald-400"
                  : "text-red-400"
              }`}
            >
              {formatInrAmount(data.summaryNetPnlInr)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Revenue share fee</p>
            <p className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-[var(--accent)]">
              {formatInrAmount(data.summaryRevShareFeeInr)}
            </p>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="!p-5">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--text-primary)]">
          Filters
        </h2>
        <form
          action="/user/transactions"
          method="get"
          className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <label className="block text-xs text-[var(--text-muted)]">
            From (IST date)
            <input
              type="date"
              name="from"
              defaultValue={filters.dateFrom ?? ""}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            To (IST date)
            <input
              type="date"
              name="to"
              defaultValue={filters.dateTo ?? ""}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            Strategy
            <select
              name="strategy"
              defaultValue={filters.strategyId ?? ""}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            >
              <option value="">All strategies</option>
              {strategyOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            Symbol contains
            <input
              type="text"
              name="symbol"
              placeholder="e.g. BTC"
              defaultValue={filters.symbol ?? ""}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            Open / closed
            <select
              name="state"
              defaultValue={filters.state}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            >
              <option value="any">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            PnL
            <select
              name="pnl"
              defaultValue={filters.pnl}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            >
              <option value="any">Any</option>
              <option value="profit">Profit only</option>
              <option value="loss">Loss only</option>
            </select>
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            Source
            <select
              name="source"
              defaultValue={filters.source}
              className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/35 px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)]/30 focus:ring-2"
            >
              <option value="all">All activity</option>
              <option value="bot_only">Bot trades only</option>
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="submit"
              className="rounded-xl bg-[var(--accent)]/90 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-[var(--accent)]"
            >
              Apply filters
            </button>
            <Link
              href="/user/transactions"
              className="rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </GlassPanel>

      <div className="md:hidden space-y-3">
        {data.rows.length === 0 ? (
          <GlassPanel className="!p-8 text-center text-sm text-[var(--text-muted)]">
            No trades match these filters.
          </GlassPanel>
        ) : (
          data.rows.map((row) => <LedgerRowCard key={`${row.ledgerKind}-${row.ledgerId}`} row={row} />)
        )}
      </div>

      <GlassPanel className="hidden overflow-hidden !p-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-glass)] bg-black/30 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-3 py-3 font-medium">Strategy</th>
                <th className="px-3 py-3 font-medium">Entry (IST)</th>
                <th className="px-3 py-3 font-medium">Exit (IST)</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Entry px</th>
                <th className="px-3 py-3 font-medium">Exit px</th>
                <th className="px-3 py-3 font-medium">Gross</th>
                <th className="px-3 py-3 font-medium">Fee</th>
                <th className="px-3 py-3 font-medium">Net PnL</th>
                <th className="px-3 py-3 font-medium">Rev share</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Tag</th>
                <th className="px-3 py-3 font-medium">Side</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-10 text-center text-[var(--text-muted)]"
                  >
                    No trades match these filters.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => {
                  const pnl = row.netPnlInr != null ? Number(row.netPnlInr) : NaN;
                  const pnlCls =
                    Number.isFinite(pnl) && pnl > 0
                      ? "text-emerald-400"
                      : Number.isFinite(pnl) && pnl < 0
                        ? "text-red-400"
                        : "text-[var(--text-muted)]";
                  const sideCls =
                    row.side === "buy"
                      ? "text-emerald-400"
                      : "text-red-400";
                  return (
                    <tr
                      key={`${row.ledgerKind}-${row.ledgerId}`}
                      className="border-b border-[var(--border-glass)]/30 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-[var(--accent)]">
                        {row.symbol}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 text-xs text-[var(--text-muted)]">
                        {row.strategyName}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--text-muted)]">
                        {istShort(row.entryTime)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--text-muted)]">
                        {istShort(row.exitTime)}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs">{row.quantity}</td>
                      <td className="px-3 py-3 tabular-nums text-xs text-[var(--text-muted)]">
                        {row.entryPrice ?? "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs text-[var(--text-muted)]">
                        {row.exitPrice ?? "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs text-[var(--text-muted)]">
                        {row.grossAmountInr != null
                          ? formatInrAmount(row.grossAmountInr)
                          : "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs text-[var(--text-muted)]">
                        {row.feeInr != null ? formatInrAmount(row.feeInr) : "—"}
                      </td>
                      <td className={`px-3 py-3 tabular-nums text-xs font-medium ${pnlCls}`}>
                        {row.netPnlInr != null ? formatInrAmount(row.netPnlInr) : "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs text-[var(--text-primary)]">
                        {formatInrAmount(row.revenueShareFeeInr)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(row.uiStatus)}`}
                        >
                          {row.uiStatus}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--text-muted)]">
                        {row.sourceTag === "bot" ? "Bot" : "Manual"}
                      </td>
                      <td
                        className={`px-3 py-3 text-xs font-medium capitalize ${sideCls}`}
                      >
                        {row.side}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">
            Page {data.page} of {totalPages} · {data.pageSize} per page
          </p>
          <div className="flex gap-2">
            {data.page > 1 ? (
              <Link
                href={mkPage(data.page - 1)}
                className="rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm text-[var(--accent)] hover:bg-white/5"
              >
                Previous
              </Link>
            ) : null}
            {data.page < totalPages ? (
              <Link
                href={mkPage(data.page + 1)}
                className="rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm text-[var(--accent)] hover:bg-white/5"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
