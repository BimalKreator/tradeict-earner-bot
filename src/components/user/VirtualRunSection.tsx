import { formatUsdAmount } from "@/lib/format-inr";
import type {
  VirtualOrderLedgerRow,
  VirtualRunOverview,
} from "@/server/queries/virtual-trading-user";
import {
  addVirtualFundsAction,
  pauseVirtualRunAction,
  resetVirtualRunAction,
  resumeVirtualRunAction,
  updateVirtualRunSettingsAction,
} from "@/server/actions/virtualTrading";

function num(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function VirtualRunSection({
  run,
  orders,
}: {
  run: VirtualRunOverview;
  orders: VirtualOrderLedgerRow[];
}) {
  const equity = num(run.virtualAvailableCashUsd) + num(run.virtualUsedMarginUsd);

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent p-5 shadow-lg shadow-black/20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
            {run.strategyName}
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Paper account ·{" "}
            <span className="capitalize">{run.status}</span>
            {run.openSymbol ? (
              <>
                {" "}
                · Open {run.openSymbol}{" "}
                <span className="tabular-nums">{run.openNetQty}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Virtual balance
            </p>
            <p className="font-semibold tabular-nums text-[var(--text-primary)]">
              {formatUsdAmount(equity)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Free cash
            </p>
            <p className="font-semibold tabular-nums text-slate-200">
              {formatUsdAmount(run.virtualAvailableCashUsd)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Used margin
            </p>
            <p className="font-semibold tabular-nums text-amber-100/90">
              {formatUsdAmount(run.virtualUsedMarginUsd)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Realized PnL
            </p>
            <p className="font-semibold tabular-nums text-emerald-100/90">
              {formatUsdAmount(run.virtualRealizedPnlUsd)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/25 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Settings
          </h3>
          <form action={updateVirtualRunSettingsAction} className="space-y-3">
            <input type="hidden" name="virtualRunId" value={run.runId} />
            <label className="block text-xs text-[var(--text-muted)]">
              Leverage
              <input
                name="leverage"
                type="text"
                defaultValue={run.leverage}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <label className="block text-xs text-[var(--text-muted)]">
              Virtual capital (USD) — editable when flat
              <input
                name="virtualCapitalUsd"
                type="text"
                defaultValue={run.virtualCapitalUsd}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              Capital changes apply to free cash only when you have no open simulated
              position.
            </p>
            <button
              type="submit"
              className="rounded-lg bg-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/[0.12]"
            >
              Save settings
            </button>
          </form>
        </div>

        <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/25 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Wallet actions
          </h3>
          <form action={addVirtualFundsAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="virtualRunId" value={run.runId} />
            <label className="min-w-[140px] flex-1 text-xs text-[var(--text-muted)]">
              Add virtual funds (USD)
              <input
                name="amountUsd"
                type="text"
                placeholder="1000"
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-100 ring-1 ring-sky-400/30 hover:bg-sky-500/30"
            >
              Add funds
            </button>
          </form>

          <form action={resetVirtualRunAction} className="pt-1">
            <input type="hidden" name="virtualRunId" value={run.runId} />
            <button
              type="submit"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/20"
            >
              Reset PnL &amp; history
            </button>
          </form>

          <div className="flex flex-wrap gap-2 pt-1">
            {run.status === "active" ? (
              <form action={pauseVirtualRunAction}>
                <input type="hidden" name="virtualRunId" value={run.runId} />
                <button
                  type="submit"
                  className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.06]"
                >
                  Pause paper run
                </button>
              </form>
            ) : (
              <form action={resumeVirtualRunAction}>
                <input type="hidden" name="virtualRunId" value={run.runId} />
                <button
                  type="submit"
                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20"
                >
                  Resume
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Virtual trade ledger
        </h3>
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="min-w-full text-left text-xs text-slate-200">
            <thead className="bg-black/40 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Entry / fill</th>
                <th className="px-3 py-2">Realized</th>
                <th className="px-3 py-2">Profit %</th>
                <th className="px-3 py-2">Signal</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    No simulated orders yet. Signals for this strategy will appear here
                    after the execution worker processes them.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-white/[0.05] bg-black/20 hover:bg-black/35"
                  >
                    <td className="px-3 py-2 tabular-nums text-slate-400">
                      {o.createdAt.toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        hour12: false,
                      })}
                    </td>
                    <td className="px-3 py-2 font-medium">{o.symbol}</td>
                    <td className="px-3 py-2 capitalize">{o.side}</td>
                    <td className="px-3 py-2 tabular-nums">{o.quantity}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-300">
                      {o.fillPrice ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {o.realizedPnlUsd != null ? formatUsdAmount(o.realizedPnlUsd) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {o.profitPercent != null
                        ? `${Number(o.profitPercent).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-400">
                      {o.signalAction ?? "—"}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-400">{o.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
