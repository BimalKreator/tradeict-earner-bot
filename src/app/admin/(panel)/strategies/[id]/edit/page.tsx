import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminStrategyForm } from "@/components/admin/AdminStrategyForm";
import { strategyDefaultsFromRow } from "@/lib/admin-strategy-form-defaults";
import { getAdminStrategyDetail } from "@/server/queries/admin-strategies";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const data = await getAdminStrategyDetail(id);
  return { title: data ? `Edit · ${data.strategy.name}` : "Edit strategy" };
}

export default async function AdminEditStrategyPage({ params }: Props) {
  const { id } = await params;
  const data = await getAdminStrategyDetail(id);
  if (!data) {
    notFound();
  }

  const defaults = strategyDefaultsFromRow(data.strategy);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/strategies/${id}`}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Strategy
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Edit strategy
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {data.strategy.name} · <span className="font-mono">{data.strategy.slug}</span>
        </p>
      </div>
      <AdminStrategyForm mode="edit" strategyId={id} defaults={defaults} />
    </div>
  );
}
