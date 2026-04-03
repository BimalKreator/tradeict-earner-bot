import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminUserPricingManager } from "@/components/admin/AdminUserPricingManager";
import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  getAdminUserPricingPageContext,
  listAdminUserPricingOverrides,
  listStrategiesForPricingOverridePicker,
} from "@/server/queries/admin-user-pricing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const ctx = await getAdminUserPricingPageContext(id);
  return { title: ctx ? `Pricing · ${ctx.email}` : "Pricing" };
}

export default async function AdminUserPricingPage({ params }: Props) {
  const { id } = await params;
  const ctx = await getAdminUserPricingPageContext(id);
  if (!ctx) {
    notFound();
  }

  const [overrides, strategyOptions] = await Promise.all([
    listAdminUserPricingOverrides(id),
    listStrategiesForPricingOverridePicker(),
  ]);

  const serialized = overrides.map((o) => ({
    id: o.id,
    strategyId: o.strategyId,
    strategyName: o.strategyName,
    strategySlug: o.strategySlug,
    monthlyFeeInrOverride: o.monthlyFeeInrOverride,
    revenueSharePercentOverride: o.revenueSharePercentOverride,
    effectiveFrom: o.effectiveFrom.toISOString(),
    effectiveUntil: o.effectiveUntil?.toISOString() ?? null,
    isActive: o.isActive,
    adminNotes: o.adminNotes,
    createdAt: o.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/users/${id}`}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Users / {ctx.email}
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Pricing overrides
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Per-strategy fee and revenue-share windows for this user.
        </p>
      </div>
      <GlassPanel>
        <AdminUserPricingManager
          targetUserId={id}
          userEmail={ctx.email}
          overrides={serialized}
          strategyOptions={strategyOptions}
        />
      </GlassPanel>
    </div>
  );
}
