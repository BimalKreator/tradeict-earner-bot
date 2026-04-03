import Link from "next/link";

import { AdminStrategiesTable } from "@/components/admin/AdminStrategiesTable";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { listStrategiesForAdmin } from "@/server/queries/admin-strategies";

export const metadata = {
  title: "Strategies",
};

export const dynamic = "force-dynamic";

export default async function AdminStrategiesPage() {
  const rows = await listStrategiesForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            Strategies
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Catalog products: fees, revenue share, visibility, lifecycle status,
            and marketing metadata. Hide/Show updates visibility only; Pause /
            Archive updates status.
          </p>
        </div>
        <Link
          href="/admin/strategies/new"
          className="inline-flex w-fit items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90"
        >
          New strategy
        </Link>
      </div>
      <GlassPanel>
        <AdminStrategiesTable rows={rows} />
      </GlassPanel>
    </div>
  );
}
