import { AdminActivityFeed } from "@/components/admin/AdminActivityFeed";
import { AdminAttentionPanel } from "@/components/admin/AdminAttentionPanel";
import { AdminMetricCards } from "@/components/admin/AdminMetricCards";
import { AdminRegistrationsChart } from "@/components/admin/AdminRegistrationsChart";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount, formatIntCount } from "@/lib/format-inr";
import { getAdminDashboardPageData } from "@/server/queries/admin-dashboard";

export const metadata = {
  title: "Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const data = await getAdminDashboardPageData();

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Dashboard
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            Database is not configured — metrics unavailable.
          </p>
        </GlassPanel>
      </div>
    );
  }

  const m = data.metrics;

  const kpiCards = [
    {
      label: "User base",
      value: formatIntCount(m.totalUsers),
      sublabel: `${formatIntCount(m.pendingApprovals)} pending approval`,
    },
    {
      label: "Active bots",
      value: formatIntCount(m.activeBotRuns),
      sublabel: "user_strategy_runs.status = active",
    },
    {
      label: "Revenue block (runs)",
      value: formatIntCount(m.blockedRevenueDueRuns),
      sublabel: "Entries paused — overdue weekly ledger",
    },
    {
      label: "Global capital allocated",
      value: formatInrAmount(m.globalCapitalAllocatedInr),
      sublabel: "Sum of capital_to_use_inr on active runs",
    },
    {
      label: "Revenue collected",
      value: formatInrAmount(m.totalCollectedRevenueInr),
      sublabel: "Sum of successful payments",
    },
    {
      label: "Revenue share pending",
      value: formatInrAmount(m.revenueSharePendingInr),
      sublabel: "Unpaid + partial weekly ledgers (all periods)",
    },
    {
      label: "Active subscriptions",
      value: formatIntCount(m.activeSubscriptions),
      sublabel: "Non-expired access windows",
    },
    {
      label: "Strategies (catalog)",
      value: formatIntCount(m.totalStrategies),
      sublabel: "Non-deleted strategies",
    },
    {
      label: "Approved users",
      value: formatIntCount(m.approvedUsers),
      sublabel: "Ready for trading features",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Platform overview
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Macro KPIs, operational alerts, and recent activity — loaded once per
          request (SSR). Distinct admin glass styling, aligned with the user
          dashboard metrics pattern.
        </p>
      </div>

      <AdminMetricCards metrics={kpiCards} />

      <AdminAttentionPanel
        runs={data.attentionRuns}
        pendingUsers={data.attentionPendingUsers}
        profileRequests={data.attentionProfileRequests}
      />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <AdminActivityFeed items={data.activity} />
        </div>
        <div className="xl:col-span-2">
          <AdminRegistrationsChart series={data.registrationsLast7Days} />
        </div>
      </div>

      <GlassPanel className="border-dashed border-[var(--border-glass)]/60 bg-black/20">
        <p className="text-sm text-[var(--text-muted)]">
          Deeper workflows:{" "}
          <span className="text-[var(--text-primary)]">Users</span>,{" "}
          <span className="text-[var(--text-primary)]">Revenue</span>,{" "}
          <span className="text-[var(--text-primary)]">Strategies</span>,{" "}
          <span className="text-[var(--text-primary)]">Audit logs</span> in the
          sidebar.
        </p>
      </GlassPanel>
    </div>
  );
}
