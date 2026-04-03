import Link from "next/link";

import {
  setStrategyStatusAction,
  setStrategyVisibilityAction,
} from "@/server/actions/adminStrategies";

import type { AdminStrategyListRow } from "@/server/queries/admin-strategies";

const VIS_LABELS: Record<string, string> = {
  public: "Public",
  hidden: "Hidden",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  hidden: "Hidden (legacy)",
  archived: "Archived",
};

const RISK_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function AdminStrategiesTable({ rows }: { rows: AdminStrategyListRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No strategies yet. Create one to populate the catalog.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-3 pr-3 font-medium">Slug</th>
            <th className="pb-3 pr-3 font-medium">Name</th>
            <th className="pb-3 pr-3 font-medium">Visibility</th>
            <th className="pb-3 pr-3 font-medium">Status</th>
            <th className="pb-3 pr-3 font-medium">Risk</th>
            <th className="pb-3 pr-3 font-medium">Fee / Rev %</th>
            <th className="pb-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
            >
              <td className="py-3 pr-3 align-top font-mono text-xs text-[var(--accent)]">
                <Link
                  href={`/admin/strategies/${r.id}`}
                  className="hover:underline"
                >
                  {r.slug}
                </Link>
              </td>
              <td className="py-3 pr-3 align-top">{r.name}</td>
              <td className="py-3 pr-3 align-top text-[var(--text-muted)]">
                <span
                  className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                    r.visibility === "hidden"
                      ? "bg-slate-500/20 text-slate-200"
                      : "bg-sky-500/15 text-sky-100"
                  }`}
                >
                  {VIS_LABELS[r.visibility] ?? r.visibility}
                </span>
              </td>
              <td className="py-3 pr-3 align-top text-[var(--text-muted)]">
                <span
                  className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                    r.status === "active"
                      ? "bg-emerald-500/15 text-emerald-100"
                      : r.status === "archived"
                        ? "bg-red-500/15 text-red-100"
                        : "bg-amber-500/15 text-amber-100"
                  }`}
                >
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
              </td>
              <td className="py-3 pr-3 align-top text-xs text-[var(--text-muted)]">
                {RISK_LABELS[r.riskLabel] ?? r.riskLabel}
              </td>
              <td className="py-3 pr-3 align-top text-xs text-[var(--text-muted)]">
                <div className="tabular-nums">
                  ₹{r.defaultMonthlyFeeInr} · {r.defaultRevenueSharePercent}%
                </div>
                {r.hasActiveUserPricingOverride ? (
                  <span className="mt-1 inline-block rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                    Custom pricing
                  </span>
                ) : null}
              </td>
              <td className="py-3 align-top">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Link
                      href={`/admin/strategies/${r.id}`}
                      className="rounded-lg border border-[var(--border-glass)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-white/5"
                    >
                      View
                    </Link>
                    <Link
                      href={`/admin/strategies/${r.id}/edit`}
                      className="rounded-lg border border-[var(--border-glass)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-white/5"
                    >
                      Edit
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.visibility === "public" ? (
                      <form action={setStrategyVisibilityAction}>
                        <input type="hidden" name="strategy_id" value={r.id} />
                        <input type="hidden" name="visibility" value="hidden" />
                        <button
                          type="submit"
                          className="rounded-lg bg-slate-600/40 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600/60"
                        >
                          Hide
                        </button>
                      </form>
                    ) : (
                      <form action={setStrategyVisibilityAction}>
                        <input type="hidden" name="strategy_id" value={r.id} />
                        <input type="hidden" name="visibility" value="public" />
                        <button
                          type="submit"
                          className="rounded-lg bg-sky-600/30 px-2 py-1 text-xs text-sky-100 hover:bg-sky-600/50"
                        >
                          Show
                        </button>
                      </form>
                    )}
                    {r.status === "active" ? (
                      <form action={setStrategyStatusAction}>
                        <input type="hidden" name="strategy_id" value={r.id} />
                        <input type="hidden" name="status" value="paused" />
                        <button
                          type="submit"
                          className="rounded-lg bg-amber-600/25 px-2 py-1 text-xs text-amber-100 hover:bg-amber-600/40"
                        >
                          Pause
                        </button>
                      </form>
                    ) : null}
                    {r.status === "paused" || r.status === "hidden" ? (
                      <form action={setStrategyStatusAction}>
                        <input type="hidden" name="strategy_id" value={r.id} />
                        <input type="hidden" name="status" value="active" />
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-600/25 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-600/40"
                        >
                          Activate
                        </button>
                      </form>
                    ) : null}
                    {r.status !== "archived" ? (
                      <form action={setStrategyStatusAction}>
                        <input type="hidden" name="strategy_id" value={r.id} />
                        <input type="hidden" name="status" value="archived" />
                        <button
                          type="submit"
                          className="rounded-lg bg-red-600/20 px-2 py-1 text-xs text-red-100 hover:bg-red-600/35"
                        >
                          Archive
                        </button>
                      </form>
                    ) : (
                      <form action={setStrategyStatusAction}>
                        <input type="hidden" name="strategy_id" value={r.id} />
                        <input type="hidden" name="status" value="paused" />
                        <button
                          type="submit"
                          className="rounded-lg border border-[var(--border-glass)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-white/5"
                        >
                          Unarchive → paused
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
