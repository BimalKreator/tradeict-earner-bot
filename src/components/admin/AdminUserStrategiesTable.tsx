import Link from "next/link";

import { formatInrAmount } from "@/lib/format-inr";
import type { AdminUserStrategyListRow } from "@/server/queries/admin-user-strategies";

const RUN_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  paused: "Paused",
  paused_revenue_due: "Paused (revenue)",
  paused_exchange_off: "Paused (exchange)",
  paused_admin: "Paused (admin)",
  paused_by_user: "Paused (user)",
  expired: "Expired",
  blocked_revenue_due: "Blocked (revenue)",
  ready_to_activate: "Ready",
};

export function AdminUserStrategiesTable({ rows }: { rows: AdminUserStrategyListRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No subscriptions match.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] border-collapse text-left text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)] sm:text-xs">
            <th className="pb-2 pr-3 font-medium">User</th>
            <th className="pb-2 pr-3 font-medium">Strategy</th>
            <th className="pb-2 pr-3 font-medium">Access until</th>
            <th className="pb-2 pr-3 font-medium">Run status</th>
            <th className="pb-2 pr-3 font-medium">Capital</th>
            <th className="pb-2 pr-3 font-medium">Lev.</th>
            <th className="pb-2 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.subscriptionId}
              className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
            >
              <td className="py-2 pr-3 align-top">
                <div className="font-medium">{r.userEmail}</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {r.userName ?? "—"}
                </div>
              </td>
              <td className="py-2 pr-3 align-top">
                <span className="font-medium">{r.strategyName}</span>
                <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">
                  {r.strategySlug}
                </span>
              </td>
              <td className="py-2 pr-3 align-top text-[var(--text-muted)]">
                {new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kolkata",
                }).format(new Date(r.accessValidUntil))}
              </td>
              <td className="py-2 pr-3 align-top">
                <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] sm:text-xs">
                  {RUN_LABELS[r.runStatus] ?? r.runStatus}
                </span>
              </td>
              <td className="py-2 pr-3 align-top tabular-nums text-[var(--text-muted)]">
                {r.capitalToUseInr ? formatInrAmount(r.capitalToUseInr) : "—"}
              </td>
              <td className="py-2 pr-3 align-top tabular-nums text-[var(--text-muted)]">
                {r.leverage ?? "—"}
              </td>
              <td className="py-2 align-top">
                <Link
                  href={`/admin/user-strategies/${r.subscriptionId}`}
                  className="text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
