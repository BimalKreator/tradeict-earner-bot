import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { UserDashboardClient } from "@/components/user/dashboard/UserDashboardClient";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { getUserDashboardData } from "@/server/queries/user-dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
};

export default async function UserDashboardPage() {
  const userId = await requireUserIdForPage("/user/dashboard");

  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel className="!p-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sign in to view your trading overview.
          </p>
          <Link
            href="/login?next=%2Fuser%2Fdashboard"
            className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  const initial = await getUserDashboardData(userId);

  if (!initial) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Dashboard
        </h1>
        <GlassPanel className="!p-6">
          <p className="text-[var(--text-muted)]">
            Dashboard data is unavailable (database not configured or query failed).
          </p>
        </GlassPanel>
      </div>
    );
  }

  return <UserDashboardClient initial={initial} />;
}
