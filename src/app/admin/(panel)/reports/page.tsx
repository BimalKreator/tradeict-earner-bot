import Link from "next/link";

import { ExportCsvButton } from "@/components/reports/ExportCsvButton";
import { ReportBarList } from "@/components/reports/ReportBarList";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount, formatIntCount } from "@/lib/format-inr";
import { getAdminReportsPageData } from "@/server/queries/admin-reports";

export const metadata = {
  title: "Reports & analytics",
};

export const dynamic = "force-dynamic";

function fmtDue(d: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export default async function AdminReportsPage() {
  const data = await getAdminReportsPageData();

  if (!data) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Database is not configured or unavailable.
        </p>
      </GlassPanel>
    );
  }

  const strategyRevBars = data.strategyRevenue.slice(0, 12).map((r) => ({
    label: r.strategyName,
    valueInr: r.totalInr,
    sub: `${formatIntCount(r.paymentCount)} payments`,
  }));

  const topStratPnlBars = data.topStrategiesPnl.map((r) => ({
    label: r.strategyName,
    valueInr: r.pnlInr,
    sub: `${r.fillsCount} bot fills (all users)`,
  }));

  const collectionBars = data.collectionWeeks.map((w) => ({
    label: w.weekStartIst,
    valueInr: w.efficiencyPct,
    sub: `Due ${formatInrAmount(w.dueInr)} · Paid ${formatInrAmount(w.paidInr)} · Waivers ${formatInrAmount(w.waivedInr)} · ${formatIntCount(w.ledgerCount)} ledgers`,
  }));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Reports & analytics
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Platform revenue, ledger collection, trading PnL leaders, unpaid dues, and
          waiver audit. Tables support CSV export. Revenue uses successful{" "}
          <code className="text-[var(--accent)]">payments</code>; PnL uses bot fills.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" id="platform">
        <GlassPanel className="border border-white/[0.06] p-4">
          <p className="text-xs text-[var(--text-muted)]">Total collected (success)</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            {formatInrAmount(data.platform.totalSuccessInr)}
          </p>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            {formatIntCount(data.platform.paymentCount)} payments
          </p>
        </GlassPanel>
        <GlassPanel className="border border-white/[0.06] p-4">
          <p className="text-xs text-[var(--text-muted)]">Subscription / access fees</p>
          <p className="mt-1 text-lg font-semibold text-emerald-200">
            {formatInrAmount(data.platform.subscriptionFeesInr)}
          </p>
        </GlassPanel>
        <GlassPanel className="border border-white/[0.06] p-4">
          <p className="text-xs text-[var(--text-muted)]">Revenue share (gateway)</p>
          <p className="mt-1 text-lg font-semibold text-sky-200">
            {formatInrAmount(data.platform.revenueShareFeesInr)}
          </p>
        </GlassPanel>
        <GlassPanel className="border border-white/[0.06] p-4 flex flex-col justify-center">
          <Link
            href="/admin/revenue"
            className="text-sm font-semibold text-[var(--accent)] underline decoration-blue-500/40 underline-offset-2"
          >
            Open revenue workspace →
          </Link>
        </GlassPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" id="strategy-revenue">
        <ReportBarList
          title="Strategy-wise revenue (fees)"
          hint="Top 12 by successful payment amount · strategy-attributed rows only"
          rows={strategyRevBars}
        />
        <GlassPanel className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Full table
            </p>
            <ExportCsvButton
              filename="admin-strategy-revenue.csv"
              columns={[
                { key: "strategyName", header: "strategy" },
                { key: "strategyId", header: "strategy_id" },
                { key: "totalInr", header: "total_inr" },
                { key: "paymentCount", header: "payment_count" },
              ]}
              rows={data.strategyRevenue.map((r) => ({
                strategyName: r.strategyName,
                strategyId: r.strategyId,
                totalInr: r.totalInr,
                paymentCount: r.paymentCount,
              }))}
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[400px] border-collapse text-left text-xs font-mono">
              <thead className="sticky top-0 bg-[#0a0c12]">
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">Strategy</th>
                  <th className="pb-2 pr-2">INR</th>
                  <th className="pb-2">#</th>
                </tr>
              </thead>
              <tbody>
                {data.strategyRevenue.map((r) => (
                  <tr key={r.strategyId} className="border-b border-[var(--border-glass)]/40">
                    <td className="py-2 pr-2">{r.strategyName}</td>
                    <td className="py-2 pr-2">{formatInrAmount(r.totalInr)}</td>
                    <td className="py-2">{r.paymentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </section>

      <section className="space-y-4" id="user-revenue">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          User-wise revenue
        </h2>
        <GlassPanel className="p-5">
          <div className="mb-3 flex flex-wrap justify-end">
            <ExportCsvButton
              filename="admin-user-revenue.csv"
              columns={[
                { key: "email", header: "email" },
                { key: "userId", header: "user_id" },
                { key: "name", header: "name" },
                { key: "totalInr", header: "total_inr" },
                { key: "paymentCount", header: "payment_count" },
              ]}
              rows={data.userRevenue.map((r) => ({
                email: r.email,
                userId: r.userId,
                name: r.name ?? "",
                totalInr: r.totalInr,
                paymentCount: r.paymentCount,
              }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">User</th>
                  <th className="pb-2 pr-2">INR</th>
                  <th className="pb-2">#</th>
                  <th className="pb-2"> </th>
                </tr>
              </thead>
              <tbody>
                {data.userRevenue.map((r) => (
                  <tr key={r.userId} className="border-b border-[var(--border-glass)]/40">
                    <td className="py-2 pr-2">
                      <span className="text-[var(--text-primary)]">{r.email}</span>
                      {r.name ? (
                        <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                          {r.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">{formatInrAmount(r.totalInr)}</td>
                    <td className="py-2 pr-2">{r.paymentCount}</td>
                    <td className="py-2">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        className="text-[var(--accent)] underline decoration-blue-500/40"
                      >
                        Profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" id="pnl-leaders">
        <ReportBarList
          title="Top strategies by realized PnL"
          hint="All users · bot filled / partial orders"
          rows={topStratPnlBars}
        />
        <GlassPanel className="p-5">
          <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">
            Top users by realized PnL
          </p>
          <div className="mb-3 flex justify-end">
            <ExportCsvButton
              filename="admin-top-users-pnl.csv"
              columns={[
                { key: "email", header: "email" },
                { key: "userId", header: "user_id" },
                { key: "pnlInr", header: "pnl_inr" },
                { key: "fillsCount", header: "fills" },
              ]}
              rows={data.topUsersPnl.map((r) => ({
                email: r.email,
                userId: r.userId,
                pnlInr: r.pnlInr,
                fillsCount: r.fillsCount,
              }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px] border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">User</th>
                  <th className="pb-2 pr-2">PnL</th>
                  <th className="pb-2">Fills</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsersPnl.map((r) => (
                  <tr key={r.userId} className="border-b border-[var(--border-glass)]/40">
                    <td className="py-2 pr-2">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        className="text-[var(--accent)] underline"
                      >
                        {r.email}
                      </Link>
                    </td>
                    <td className="py-2 pr-2">{formatInrAmount(r.pnlInr)}</td>
                    <td className="py-2">{r.fillsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </section>

      <section className="space-y-4" id="unpaid">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Unpaid dues (revenue ledgers)
        </h2>
        <GlassPanel className="p-5">
          <div className="mb-3 flex flex-wrap justify-end">
            <ExportCsvButton
              filename="admin-unpaid-revenue-ledgers.csv"
              columns={[
                { key: "ledgerId", header: "ledger_id" },
                { key: "userEmail", header: "user_email" },
                { key: "strategyName", header: "strategy" },
                { key: "weekStartIst", header: "week_start_ist" },
                { key: "weekEndIst", header: "week_end_ist" },
                { key: "amountDueInr", header: "amount_due_inr" },
                { key: "amountPaidInr", header: "amount_paid_inr" },
                { key: "outstandingInr", header: "outstanding_inr" },
                { key: "status", header: "status" },
                { key: "dueAt", header: "due_at_utc" },
              ]}
              rows={data.unpaidDues.map((r) => ({
                ledgerId: r.ledgerId,
                userEmail: r.userEmail,
                strategyName: r.strategyName,
                weekStartIst: r.weekStartIst,
                weekEndIst: r.weekEndIst,
                amountDueInr: r.amountDueInr,
                amountPaidInr: r.amountPaidInr,
                outstandingInr: r.outstandingInr,
                status: r.status,
                dueAt: r.dueAt.toISOString(),
              }))}
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs font-mono">
              <thead className="sticky top-0 bg-[#0a0c12]">
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">Due</th>
                  <th className="pb-2 pr-2">User</th>
                  <th className="pb-2 pr-2">Week</th>
                  <th className="pb-2 pr-2">Outstanding</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.unpaidDues.map((r) => (
                  <tr key={r.ledgerId} className="border-b border-[var(--border-glass)]/40">
                    <td className="py-2 pr-2 text-[10px] text-[var(--text-muted)]">
                      {fmtDue(r.dueAt)}
                    </td>
                    <td className="py-2 pr-2">{r.userEmail}</td>
                    <td className="py-2 pr-2 text-[10px]">
                      {r.weekStartIst} → {r.weekEndIst}
                    </td>
                    <td className="py-2 pr-2 text-amber-200">
                      {formatInrAmount(r.outstandingInr)}
                    </td>
                    <td className="py-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </section>

      <section className="space-y-4" id="waivers">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Waiver report
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Rows from <code className="text-[var(--accent)]">fee_waivers</code>; blank
            amount = full ledger waiver at application time.
          </p>
        </div>
        <GlassPanel className="p-5">
            <div className="mb-3 flex flex-wrap justify-end">
              <ExportCsvButton
                filename="admin-fee-waivers.csv"
                columns={[
                  { key: "createdAt", header: "created_at_utc" },
                  { key: "userEmail", header: "user_email" },
                  { key: "strategyName", header: "strategy" },
                  { key: "amountInr", header: "amount_inr" },
                  { key: "reason", header: "reason" },
                  { key: "weekStartIst", header: "ledger_week_start_ist" },
                  { key: "ledgerId", header: "ledger_id" },
                ]}
                rows={data.waivers.map((r) => ({
                  createdAt: r.createdAt.toISOString(),
                  userEmail: r.userEmail,
                  strategyName: r.strategyName ?? "",
                  amountInr: r.amountInr ?? "",
                  reason: r.reason,
                  weekStartIst: r.weekStartIst ?? "",
                  ledgerId: r.ledgerId ?? "",
                }))}
              />
            </div>
            <div className="max-h-[380px] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs font-mono">
                <thead className="sticky top-0 bg-[#0a0c12]">
                  <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="pb-2 pr-2">When</th>
                    <th className="pb-2 pr-2">User</th>
                    <th className="pb-2 pr-2">INR</th>
                    <th className="pb-2 pr-2">Week</th>
                    <th className="pb-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.waivers.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border-glass)]/40">
                      <td className="py-2 pr-2 text-[10px] text-[var(--text-muted)]">
                        {fmtDue(r.createdAt)}
                      </td>
                      <td className="py-2 pr-2">{r.userEmail}</td>
                      <td className="py-2 pr-2">
                        {r.amountInr ? formatInrAmount(r.amountInr) : "— (full)"}
                      </td>
                      <td className="py-2 pr-2 text-[10px]">{r.weekStartIst ?? "—"}</td>
                      <td className="max-w-[240px] truncate py-2 text-[10px] text-[var(--text-muted)]">
                        {r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </GlassPanel>
      </section>

      <section className="space-y-4" id="collection">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Collection efficiency by IST week
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          For each revenue week:{" "}
          <code className="text-[var(--accent)]">100 × (ledger paid + recorded waiver INR) / ledger due</code>
          , capped at 100%. Waivers only include rows with explicit{" "}
          <code className="text-[var(--accent)]">fee_waivers.amount_inr</code>.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportBarList
            title="Efficiency %"
            hint="Latest weeks with ledger activity (up to 16)"
            rows={collectionBars}
            valueMode="percent"
          />
          <GlassPanel className="p-5">
            <div className="mb-3 flex flex-wrap justify-end">
              <ExportCsvButton
                filename="admin-collection-efficiency-by-week.csv"
                columns={[
                  { key: "weekStartIst", header: "week_start_ist" },
                  { key: "dueInr", header: "due_inr" },
                  { key: "paidInr", header: "paid_inr" },
                  { key: "waivedInr", header: "waiver_inr_recorded" },
                  { key: "efficiencyPct", header: "efficiency_pct" },
                  { key: "ledgerCount", header: "ledger_count" },
                ]}
                rows={data.collectionWeeks.map((w) => ({
                  weekStartIst: w.weekStartIst,
                  dueInr: w.dueInr,
                  paidInr: w.paidInr,
                  waivedInr: w.waivedInr,
                  efficiencyPct: w.efficiencyPct,
                  ledgerCount: w.ledgerCount,
                }))}
              />
            </div>
            <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-xs font-mono">
                <thead className="sticky top-0 bg-[#0a0c12]">
                  <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                    <th className="pb-2 pr-2">Week start</th>
                    <th className="pb-2 pr-2">Due</th>
                    <th className="pb-2 pr-2">Paid</th>
                    <th className="pb-2 pr-2">Waivers</th>
                    <th className="pb-2">Eff. %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.collectionWeeks.map((w) => (
                    <tr key={w.weekStartIst} className="border-b border-[var(--border-glass)]/40">
                      <td className="py-2 pr-2">{w.weekStartIst}</td>
                      <td className="py-2 pr-2">{formatInrAmount(w.dueInr)}</td>
                      <td className="py-2 pr-2">{formatInrAmount(w.paidInr)}</td>
                      <td className="py-2 pr-2">{formatInrAmount(w.waivedInr)}</td>
                      <td className="py-2 text-sky-200">
                        {Number(w.efficiencyPct).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>
        </div>
      </section>
    </div>
  );
}
