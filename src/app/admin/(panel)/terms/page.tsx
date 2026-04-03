import { desc } from "drizzle-orm";

import { AdminTermsTable } from "@/components/admin/AdminTermsTable";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { db } from "@/server/db";
import { termsVersions } from "@/server/db/schema";

export const metadata = {
  title: "Terms",
};

export const dynamic = "force-dynamic";

export default async function AdminTermsPage() {
  const rows =
    db != null
      ? await db
          .select({
            version: termsVersions.version,
            title: termsVersions.title,
            effectiveFrom: termsVersions.effectiveFrom,
          })
          .from(termsVersions)
          .orderBy(desc(termsVersions.version))
      : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Terms &amp; conditions
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Published versions from <code className="text-[var(--accent)]">terms_versions</code>.
          Creating or editing versions from the admin UI is planned for a later
          phase.
        </p>
      </div>
      <GlassPanel>
        <AdminTermsTable rows={rows} />
      </GlassPanel>
    </div>
  );
}
