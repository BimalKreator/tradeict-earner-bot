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

type AccountKey = "primary" | "secondary";

function isFilledOrder(status: string): boolean {
  return status === "filled" || status === "partial_fill";
}

function classifyOrderAccount(order: VirtualOrderLedgerRow): AccountKey {
  const cid = (order.correlationId ?? "").toLowerCase();
  if (cid.includes("_d2_") || cid.includes("delta2")) return "secondary";
  return "primary";
}

function deriveAccountMetrics(
  orders: VirtualOrderLedgerRow[],
  baseCapitalUsd: number,
): {
  virtualCapitalUsd: number;
  virtualBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openNetQty: number;
  openSymbol: string | null;
} {
  let q = 0;
  let avg: number | null = null;
  let realized = 0;
  let latestMark: number | null = null;
  let openSymbol: string | null = null;

  const ordered = [...orders]
    .filter((o) => isFilledOrder(o.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const o of ordered) {
    const qty = num(o.quantity);
    const fill = o.fillPrice != null ? num(o.fillPrice) : 0;
    if (qty <= 0 || fill <= 0) continue;
    latestMark = fill;

    const delta = o.side === "buy" ? qty : -qty;
    if (q === 0) {
      q = delta;
      avg = fill;
      openSymbol = o.symbol;
      continue;
    }

    const sameDirection = Math.sign(q) === Math.sign(delta);
    if (sameDirection) {
      const oldAbs = Math.abs(q);
      const addAbs = Math.abs(delta);
      const newAbs = oldAbs + addAbs;
      avg = avg == null ? fill : (oldAbs * avg + addAbs * fill) / newAbs;
      q += delta;
      openSymbol = o.symbol;
      continue;
    }

    const closeAbs = Math.min(Math.abs(q), Math.abs(delta));
    const entry = avg ?? fill;
    realized += closeAbs * Math.sign(q) * (fill - entry);
    q += delta;
    if (Math.abs(q) < 1e-8) {
      q = 0;
      avg = null;
      openSymbol = null;
    } else {
      openSymbol = o.symbol;
    }
  }

  const unrealized =
    q !== 0 && avg != null && latestMark != null ? q * (latestMark - avg) : 0;

  return {
    virtualCapitalUsd: baseCapitalUsd,
    virtualBalanceUsd: baseCapitalUsd + realized + unrealized,
    realizedPnlUsd: realized,
    unrealizedPnlUsd: unrealized,
    openNetQty: q,
    openSymbol,
  };
}

function renderLedgerTable(rows: VirtualOrderLedgerRow[]) {
  return (
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">
                No simulated orders yet for this account.
              </td>
            </tr>
          ) : (
            rows.map((o) => (
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
                  {o.profitPercent != null ? `${Number(o.profitPercent).toFixed(2)}%` : "—"}
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
  );
}

export function VirtualRunSection({
  run,
  orders,
}: {
  run: VirtualRunOverview;
  orders: VirtualOrderLedgerRow[];
}) {
  const equity = num(run.virtualAvailableCashUsd) + num(run.virtualUsedMarginUsd);
  const isMultiAccountTrendArb = run.strategySlug
    .trim()
    .toLowerCase()
    .includes("trend-arb");
  const primaryOrders = orders.filter((o) => classifyOrderAccount(o) === "primary");
  const secondaryOrders = orders.filter((o) => classifyOrderAccount(o) === "secondary");
  const splitCapital = num(run.virtualCapitalUsd) / 2;
  const primaryMetrics = deriveAccountMetrics(primaryOrders, splitCapital);
  const secondaryMetrics = deriveAccountMetrics(secondaryOrders, splitCapital);
  const combinedSystemPnl =
    primaryMetrics.realizedPnlUsd +
    primaryMetrics.unrealizedPnlUsd +
    secondaryMetrics.realizedPnlUsd +
    secondaryMetrics.unrealizedPnlUsd;

  const renderAccountCard = (
    title: string,
    metrics: ReturnType<typeof deriveAccountMetrics>,
    rows: VirtualOrderLedgerRow[],
  ) => (
    <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/25 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Virtual capital</p>
          <p className="font-semibold tabular-nums text-[var(--text-primary)]">
            {formatUsdAmount(metrics.virtualCapitalUsd)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Virtual balance</p>
          <p className="font-semibold tabular-nums text-[var(--text-primary)]">
            {formatUsdAmount(metrics.virtualBalanceUsd)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Active position</p>
          <p className="font-semibold tabular-nums text-slate-200">
            {metrics.openSymbol && Math.abs(metrics.openNetQty) > 0
              ? `${metrics.openSymbol} ${metrics.openNetQty.toFixed(4)}`
              : "None"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Unrealized PnL</p>
          <p className="font-semibold tabular-nums text-emerald-100/90">
            {formatUsdAmount(metrics.unrealizedPnlUsd)}
          </p>
        </div>
      </div>
      {renderLedgerTable(rows)}
    </div>
  );

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
        {isMultiAccountTrendArb ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
              <p className="text-[10px] uppercase tracking-wide text-sky-200/80">
                Combined system PnL
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-sky-100">
                {formatUsdAmount(combinedSystemPnl)}
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {renderAccountCard(
                "Delta 1 Account (Primary)",
                primaryMetrics,
                primaryOrders,
              )}
              {renderAccountCard(
                "Delta 2 Account (Hedge)",
                secondaryMetrics,
                secondaryOrders,
              )}
            </div>
          </div>
        ) : (
          <>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Virtual trade ledger
            </h3>
            {renderLedgerTable(orders)}
          </>
        )}
      </div>
    </section>
  );
}
