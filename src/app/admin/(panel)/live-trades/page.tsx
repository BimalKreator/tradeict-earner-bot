import { AdminLivePositionsSection } from "@/components/admin/AdminLivePositionsSection";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { db } from "@/server/db";
import { getAdminLiveOpenPositions } from "@/server/queries/live-positions-dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live trades",
};

export default async function AdminLiveTradesPage() {
  if (!db) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Live trades
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">Database is not configured.</p>
        </GlassPanel>
      </div>
    );
  }

  const positions = await getAdminLiveOpenPositions();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Live trades
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          All non-flat <code className="text-violet-200/90">bot_positions</code> for approved users
          with active subscriptions and strategy runs. Marks from the public Delta India ticker.
        </p>
      </div>

      <AdminLivePositionsSection initialRows={positions} />
    </div>
  );
}
