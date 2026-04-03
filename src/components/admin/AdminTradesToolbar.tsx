import type { AdminStrategyListRow } from "@/server/queries/admin-strategies";
import type { AdminTradeLedgerFilters } from "@/server/queries/admin-trades-ledger";

function buildPageHref(
  base: Record<string, string>,
  page: number,
): string {
  const p = new URLSearchParams({ ...base, page: String(page) });
  const qs = p.toString();
  return qs ? `/admin/trades?${qs}` : "/admin/trades";
}

export function AdminTradesToolbar(props: {
  strategies: AdminStrategyListRow[];
  values: {
    dateFrom: string;
    dateTo: string;
    userQ: string;
    strategyId: string;
    pnl: AdminTradeLedgerFilters["pnl"];
    execOutcome: AdminTradeLedgerFilters["execOutcome"];
    page: number;
    pageSize: number;
    totalPages: number;
  };
}) {
  const { strategies, values: v } = props;
  const base: Record<string, string> = {};
  if (v.dateFrom) base.dateFrom = v.dateFrom;
  if (v.dateTo) base.dateTo = v.dateTo;
  if (v.userQ) base.q = v.userQ;
  if (v.strategyId) base.strategyId = v.strategyId;
  if (v.pnl !== "any") base.pnl = v.pnl;
  if (v.execOutcome !== "any") base.exec = v.execOutcome;

  return (
    <div className="space-y-4">
      <form
        method="get"
        className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-end"
      >
        <input type="hidden" name="page" value="1" />
        <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          From (IST date)
          <input
            type="date"
            name="dateFrom"
            defaultValue={v.dateFrom}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          To (IST date)
          <input
            type="date"
            name="dateTo"
            defaultValue={v.dateTo}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
          User email / name
          <input
            type="search"
            name="q"
            defaultValue={v.userQ}
            placeholder="Search"
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          Strategy
          <select
            name="strategyId"
            defaultValue={v.strategyId}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">All</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          PnL
          <select
            name="pnl"
            defaultValue={v.pnl}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="any">All</option>
            <option value="profit">Profit only</option>
            <option value="loss">Loss only</option>
          </select>
        </label>
        <label className="flex min-w-[180px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          Execution
          <select
            name="exec"
            defaultValue={v.execOutcome}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="any">All</option>
            <option value="success">Success</option>
            <option value="failure">Failure (bot failed/rejected)</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {v.totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>Page {v.page} / {v.totalPages}</span>
          {v.page > 1 ? (
            <a
              href={buildPageHref(base, v.page - 1)}
              className="rounded-md border border-[var(--border-glass)] px-2 py-1 text-[var(--accent)] hover:bg-white/5"
            >
              Previous
            </a>
          ) : null}
          {v.page < v.totalPages ? (
            <a
              href={buildPageHref(base, v.page + 1)}
              className="rounded-md border border-[var(--border-glass)] px-2 py-1 text-[var(--accent)] hover:bg-white/5"
            >
              Next
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
