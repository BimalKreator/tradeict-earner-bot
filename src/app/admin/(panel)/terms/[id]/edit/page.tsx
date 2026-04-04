import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminTermsEditForm } from "@/components/admin/AdminTermsEditForm";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { getTermsVersionForAdminEdit } from "@/server/actions/adminTermsActions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const row = await getTermsVersionForAdminEdit(id);
  return {
    title: row ? `Terms: ${row.versionName}` : "Edit terms",
  };
}

export default async function AdminEditTermsPage({ params }: Props) {
  const { id } = await params;
  const row = await getTermsVersionForAdminEdit(id);
  if (!row) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            Edit terms
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            <span className="text-[var(--text-primary)]">{row.versionName}</span>
            <span className="mx-2 text-[var(--border-glass)]">·</span>
            <span className="capitalize">{row.status}</span>
          </p>
        </div>
        <Link
          href="/admin/terms"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← All versions
        </Link>
      </div>
      <GlassPanel>
        <AdminTermsEditForm
          row={{
            id: row.id,
            versionName: row.versionName,
            content: row.content,
            status: row.status,
          }}
        />
      </GlassPanel>
    </div>
  );
}
