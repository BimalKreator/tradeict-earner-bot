import { AdminMetricCards } from "@/components/admin/AdminMetricCards";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount, formatIntCount } from "@/lib/format-inr";
import { getAdminDashboardMetrics } from "@/server/queries/admin-dashboard";

export const metadata = {
  title: "Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const m = await getAdminDashboardMetrics();

  const cards = [
    {
      label: "Total users",
      value: formatIntCount(m.totalUsers),
      sublabel: "Excluding deleted accounts",
    },
    {
      label: "Pending approvals",
      value: formatIntCount(m.pendingApprovals),
      sublabel: "Awaiting admin decision",
    },
    {
      label: "Approved users",
      value: formatIntCount(m.approvedUsers),
      sublabel: "approval_status = approved",
    },
    {
      label: "Strategies",
      value: formatIntCount(m.totalStrategies),
      sublabel: "Non-deleted catalog rows",
    },
    {
      label: "Active subscriptions",
      value: formatIntCount(m.activeSubscriptions),
      sublabel: "status active & access not expired",
    },
    {
      label: "Weekly revenue due",
      value: formatInrAmount(m.weeklyDueInr),
      sublabel: "Unpaid + partial ledger balances",
    },
    {
      label: "Collected revenue",
      value: formatInrAmount(m.totalCollectedRevenueInr),
      sublabel: "Payments with status success",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Live counts from the database. Revenue figures will grow as Cashfree
          and ledger workflows go live.
        </p>
      </div>
      <AdminMetricCards metrics={cards} />
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Use the sidebar for user lifecycle, strategies, revenue ledgers,
          published terms, and the audit trail.
        </p>
      </GlassPanel>
    </div>
  );
}
