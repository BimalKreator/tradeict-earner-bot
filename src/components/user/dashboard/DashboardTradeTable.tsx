import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { TableScroll } from "@/components/ui/TableScroll";
import { formatUsdAmount } from "@/lib/format-inr";
import type { UserDashboardTradeRow } from "@/lib/user-dashboard-types";

function formatTradePnl(n: string | null): string {
  if (n === null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  return formatUsdAmount(v);
}

function TradeMobileCard({
  r,
  mode,
}: {
  r: UserDashboardTradeRow;
  mode: "bot" | "all";
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-glass)] bg-black/30 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {r.strategyName ?? "—"}
          </p>
          <p className="font-mono text-xs text-[var(--accent)]">{r.symbol}</p>
        </div>
        <p className="text-[10px] text-[var(--text-muted)]">
          {new Date(r.at).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "short",
            timeStyle: "short",
          })}{" "}
          IST
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">Side</p>
          <p className="capitalize text-[var(--text-primary)]">{r.side}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Qty</p>
          <p className="tabular-nums text-[var(--text-primary)]">{r.quantity}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">{mode === "bot" ? "Fill" : "Price"}</p>
          <p className="tabular-nums text-[var(--text-muted)]">{r.priceOrFill ?? "—"}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">PnL (USD)</p>
          <p
            className={`tabular-nums font-medium ${
              r.pnlInr && Number(r.pnlInr) < 0
                ? "text-red-300"
                : r.pnlInr && Number(r.pnlInr) > 0
                  ? "text-emerald-300"
                  : "text-[var(--text-muted)]"
            }`}
          >
            {formatTradePnl(r.pnlInr)}
          </p>
        </div>
        {mode === "bot" && r.orderStatus ? (
          <div className="col-span-2">
            <p className="text-[var(--text-muted)]">Status</p>
            <p className="text-[var(--text-primary)]">{r.orderStatus}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DashboardTradeTable({
  title,
  rows,
  mode,
}: {
  title: string;
  rows: UserDashboardTradeRow[];
  mode: "bot" | "all";
}) {
  const emptyDescription =
    mode === "bot"
      ? "When your bot fills orders, they will show up here with PnL and status."
      : "Trades from the ledger (including manual activity) will appear here.";

  return (
    <GlassPanel className="!overflow-hidden !p-0">
      <div className="border-b border-[var(--border-glass)] px-4 py-4 sm:px-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {mode === "bot"
            ? "Recent bot execution orders (trade_source = bot)."
            : "Recorded trades ledger (includes manual imports when present)."}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description={emptyDescription}
          action={
            <Link href="/user/transactions" className="btn-secondary inline-flex">
              View full transactions
            </Link>
          }
        />
      ) : (
        <>
          <div className="space-y-3 p-4 md:hidden">
            {rows.map((r) => (
              <TradeMobileCard key={r.id} r={r} mode={mode} />
            ))}
          </div>

          <div className="hidden md:block">
            <TableScroll>
              <table className="table-sticky-first w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-glass)]/60 bg-black/20 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-4 py-3 pl-3 font-medium">Strategy</th>
                    <th className="px-3 py-3 font-medium">Symbol</th>
                    <th className="px-3 py-3 font-medium">Side</th>
                    <th className="px-3 py-3 font-medium">Qty</th>
                    <th className="px-3 py-3 font-medium">
                      {mode === "bot" ? "Fill" : "Price"}
                    </th>
                    <th className="px-3 py-3 font-medium">PnL (USD)</th>
                    {mode === "bot" ? (
                      <th className="px-3 py-3 font-medium">Status</th>
                    ) : null}
                    <th className="px-4 py-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--border-glass)]/30 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 pl-3 text-[var(--text-primary)]">
                        {r.strategyName ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-[var(--accent)]">
                        {r.symbol}
                      </td>
                      <td className="px-3 py-3 capitalize">{r.side}</td>
                      <td className="px-3 py-3 tabular-nums text-[var(--text-muted)]">
                        {r.quantity}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-[var(--text-muted)]">
                        {r.priceOrFill ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-3 tabular-nums ${
                          r.pnlInr && Number(r.pnlInr) < 0
                            ? "text-red-300"
                            : r.pnlInr && Number(r.pnlInr) > 0
                              ? "text-emerald-300"
                              : "text-[var(--text-muted)]"
                        }`}
                      >
                        {formatTradePnl(r.pnlInr)}
                      </td>
                      {mode === "bot" ? (
                        <td className="px-3 py-3 text-xs text-[var(--text-muted)]">
                          {r.orderStatus ?? "—"}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                        {new Date(r.at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        </>
      )}
    </GlassPanel>
  );
}
