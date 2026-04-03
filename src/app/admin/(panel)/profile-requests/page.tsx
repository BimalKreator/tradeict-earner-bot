import { AdminProfileRequestsTable } from "@/components/admin/AdminProfileRequestsTable";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { getPendingProfileChangeRequestsForAdmin } from "@/server/queries/profile-change-requests";

export const metadata = {
  title: "Profile requests",
};

export const dynamic = "force-dynamic";

export default async function AdminProfileRequestsPage() {
  const rows = await getPendingProfileChangeRequestsForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Profile change requests
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Review proposed updates to name, address, mobile, WhatsApp, and email.
          Approving applies changes to the live user record.
        </p>
      </div>
      <GlassPanel>
        <AdminProfileRequestsTable rows={rows} />
      </GlassPanel>
    </div>
  );
}
