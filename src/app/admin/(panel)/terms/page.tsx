import Link from "next/link";

import { AdminTermsVersionsTable } from "@/components/admin/AdminTermsVersionsTable";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { db } from "@/server/db";
import { listTermsVersionsForAdmin } from "@/server/actions/adminTermsActions";

export const metadata = {
  title: "Terms",
};

export const dynamic = "force-dynamic";

export default async function AdminTermsPage() {
  const rows = db != null ? await listTermsVersionsForAdmin() : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            Terms &amp; conditions
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Version-controlled legal copy. Only one version may be <strong>published</strong> at a
            time. Rows are never deleted — archive for traceability.
          </p>
        </div>
        <Link
          href="/admin/terms/new"
          className="inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
        >
          New version
        </Link>
      </div>
      <GlassPanel>
        <AdminTermsVersionsTable rows={rows} />
      </GlassPanel>
    </div>
  );
}
