import { notFound } from "next/navigation";
import { z } from "zod";

import { AdminUserBillingClient } from "@/components/admin/AdminUserBillingClient";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { getAdminUserBillingDetail } from "@/server/queries/admin-revenue";

export const metadata = {
  title: "User billing",
};

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserBillingPage({ params }: Props) {
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    notFound();
  }

  const data = await getAdminUserBillingDetail(userId);
  if (!data) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Billing
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {data.email}
          {data.name ? (
            <span className="text-[var(--text-muted)]"> · {data.name}</span>
          ) : null}
        </p>
      </div>

      <GlassPanel>
        <AdminUserBillingClient userId={userId} data={data} />
      </GlassPanel>
    </div>
  );
}
