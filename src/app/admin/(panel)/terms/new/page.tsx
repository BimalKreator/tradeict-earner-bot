import Link from "next/link";

import { AdminTermsNewForm } from "@/components/admin/AdminTermsNewForm";
import { GlassPanel } from "@/components/ui/GlassPanel";

export const metadata = {
  title: "New terms version",
};

export default function AdminNewTermsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            New terms version
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create a <strong>draft</strong>. Publish from the editor when ready — the current
            published version is archived automatically.
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
        <AdminTermsNewForm />
      </GlassPanel>
    </div>
  );
}
