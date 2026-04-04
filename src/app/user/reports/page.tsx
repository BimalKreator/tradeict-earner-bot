import { ExportCsvButton } from "@/components/reports/ExportCsvButton";
import { ReportBarList } from "@/components/reports/ReportBarList";
import { ReportLineChart } from "@/components/reports/ReportLineChart";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount } from "@/lib/format-inr";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { getUserReportsBundle } from "@/server/queries/user-reports";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reports",
};

function fmtTs(d: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export default async function UserReportsPage() {
  const userId = await requireUserIdForPage("/user/reports");
  if (!userId) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Sign in to view reports. When AUTH_PHASE1_BYPASS is enabled, open a user
          session first.
        </p>
      </GlassPanel>
    );
  }

  const data = await getUserReportsBundle(userId);
  if (!data) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Database is not configured or unavailable.
        </p>
      </GlassPanel>
    );
  }

  const strategyBars = data.strategyPnl.map((r) => ({
    label: r.strategyName,
    valueInr: r.pnlInr,
    sub: `${r.fillsCount} fills · 365d IST window`,
  }));

  const fixedFeeCsv = data.fixedFees.map((r) => ({
    createdAt: r.createdAt.toISOString(),
    amountInr: r.amountInr,
    strategyName: r.strategyName ?? "",
    subscriptionId: r.subscriptionId ?? "",
    status: r.status,
    externalPaymentId: r.externalPaymentId ?? "",
  }));

  const revShareCsv = data.revShare.map((r) => ({
    createdAt: r.createdAt.toISOString(),
    amountInr: r.amountInr,
    strategyName: r.strategyName ?? "",
    weekStartIst: r.weekStartIst ?? "",
    weekEndIst: r.weekEndIst ?? "",
    ledgerStatus: r.ledgerStatus ?? "",
    externalPaymentId: r.externalPaymentId ?? "",
  }));

  const dailyCsv = data.dailyPnl.map((r) => ({
    dateIst: r.label,
    pnlInr: r.valueInr,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Reports & analytics
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Realized bot PnL by IST calendar period, strategy attribution, and
          successful payment history. Export CSV for spreadsheets. PnL sums use{" "}
          <code className="text-[var(--accent)]">bot_orders.realized_pnl_inr</code>{" "}
          on filled / partial fills.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassPanel className="border border-white/[0.06] p-4">
          <p className="text-xs text-[var(--text-muted)]">90d daily window total</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            {formatInrAmount(data.totals.dailyWindowPnlInr)}
          </p>
        </GlassPanel>
        <GlassPanel className="border border-white/[0.06] p-4">
          <p className="text-xs text-[var(--text-muted)]">Weekly series window total</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            {formatInrAmount(data.totals.weeklyWindowPnlInr)}
          </p>
        </GlassPanel>
        <GlassPanel className="border border-white/[0.06] p-4">
          <p className="text-xs text-[var(--text-muted)]">Monthly series window total</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            {formatInrAmount(data.totals.monthlyWindowPnlInr)}
          </p>
        </GlassPanel>
      </div>

      <section className="grid gap-4 xl:grid-cols-3" id="pnl">
        <ReportLineChart
          title="Daily PnL"
          hint="Last 90 IST calendar days"
          series={data.dailyPnl}
        />
        <ReportLineChart
          title="Weekly PnL"
          hint="IST week buckets (Mon-aligned), ~13 weeks of activity"
          series={data.weeklyPnl}
        />
        <ReportLineChart
          title="Monthly PnL"
          hint="YYYY-MM in IST, last 12 months with fills"
          series={data.monthlyPnl}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <ExportCsvButton
          filename="tradeict-daily-pnl-90d.csv"
          columns={[
            { key: "dateIst", header: "date_ist" },
            { key: "pnlInr", header: "realized_pnl_inr" },
          ]}
          rows={dailyCsv}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-2" id="strategy-pnl">
        <ReportBarList
          title="Strategy-wise PnL"
          hint="365d IST · realized bot fills only"
          rows={strategyBars}
        />
        <GlassPanel className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Strategy table
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                Export-friendly · same data as chart
              </p>
            </div>
            <ExportCsvButton
              filename="tradeict-strategy-pnl.csv"
              columns={[
                { key: "strategyName", header: "strategy" },
                { key: "slug", header: "slug" },
                { key: "pnlInr", header: "pnl_inr_365d" },
                { key: "fillsCount", header: "fills" },
              ]}
              rows={data.strategyPnl.map((r) => ({
                strategyName: r.strategyName,
                slug: r.strategySlug,
                pnlInr: r.pnlInr,
                fillsCount: r.fillsCount,
              }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">Strategy</th>
                  <th className="pb-2 pr-2">PnL (INR)</th>
                  <th className="pb-2">Fills</th>
                </tr>
              </thead>
              <tbody>
                {data.strategyPnl.map((r) => (
                  <tr
                    key={r.strategyId}
                    className="border-b border-[var(--border-glass)]/40"
                  >
                    <td className="py-2 pr-2 text-[var(--text-primary)]">
                      {r.strategyName}
                    </td>
                    <td className="py-2 pr-2 text-sky-200">{formatInrAmount(r.pnlInr)}</td>
                    <td className="py-2 text-[var(--text-muted)]">{r.fillsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </section>

      <section className="space-y-4" id="payments">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Payment history
        </h2>
        <GlassPanel className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Fixed fee (access / subscription)
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Successful payments not tied to a revenue-share ledger row
              </p>
            </div>
            <ExportCsvButton
              filename="tradeict-fixed-fee-payments.csv"
              columns={[
                { key: "createdAt", header: "created_at_utc" },
                { key: "amountInr", header: "amount_inr" },
                { key: "strategyName", header: "strategy" },
                { key: "subscriptionId", header: "subscription_id" },
                { key: "status", header: "status" },
                { key: "externalPaymentId", header: "external_payment_id" },
              ]}
              rows={fixedFeeCsv}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">When (IST)</th>
                  <th className="pb-2 pr-2">Amount</th>
                  <th className="pb-2 pr-2">Strategy</th>
                  <th className="pb-2">Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.fixedFees.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-[var(--text-muted)]">
                      No fixed-fee payments yet.
                    </td>
                  </tr>
                ) : (
                  data.fixedFees.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border-glass)]/40">
                      <td className="py-2 pr-2 text-[var(--text-muted)]">
                        {fmtTs(r.createdAt)}
                      </td>
                      <td className="py-2 pr-2 text-emerald-200">
                        {formatInrAmount(r.amountInr)}
                      </td>
                      <td className="py-2 pr-2">{r.strategyName ?? "—"}</td>
                      <td className="max-w-[200px] truncate py-2 text-[10px] text-[var(--text-muted)]">
                        {r.externalPaymentId ?? r.id}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Revenue share settlements
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Successful payments linked to weekly revenue ledgers
              </p>
            </div>
            <ExportCsvButton
              filename="tradeict-revenue-share-payments.csv"
              columns={[
                { key: "createdAt", header: "created_at_utc" },
                { key: "amountInr", header: "amount_inr" },
                { key: "strategyName", header: "strategy" },
                { key: "weekStartIst", header: "week_start_ist" },
                { key: "weekEndIst", header: "week_end_ist" },
                { key: "ledgerStatus", header: "ledger_status" },
                { key: "externalPaymentId", header: "external_payment_id" },
              ]}
              rows={revShareCsv}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">When (IST)</th>
                  <th className="pb-2 pr-2">Amount</th>
                  <th className="pb-2 pr-2">Week (IST)</th>
                  <th className="pb-2 pr-2">Strategy</th>
                  <th className="pb-2">Ledger</th>
                </tr>
              </thead>
              <tbody>
                {data.revShare.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-[var(--text-muted)]">
                      No revenue-share payments yet.
                    </td>
                  </tr>
                ) : (
                  data.revShare.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border-glass)]/40">
                      <td className="py-2 pr-2 text-[var(--text-muted)]">
                        {fmtTs(r.createdAt)}
                      </td>
                      <td className="py-2 pr-2 text-sky-200">
                        {formatInrAmount(r.amountInr)}
                      </td>
                      <td className="py-2 pr-2 text-[10px] text-[var(--text-primary)]">
                        {r.weekStartIst ?? "—"} → {r.weekEndIst ?? "—"}
                      </td>
                      <td className="py-2 pr-2">{r.strategyName ?? "—"}</td>
                      <td className="py-2 text-[10px] text-[var(--text-muted)]">
                        {r.ledgerStatus ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}
