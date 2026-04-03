import { desc } from "drizzle-orm";

import { AdminAuditTable } from "@/components/admin/AdminAuditTable";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { db } from "@/server/db";
import { auditLogs } from "@/server/db/schema";

export const metadata = {
  title: "Audit logs",
};

export const dynamic = "force-dynamic";

export default async function AdminAuditLogsPage() {
  const rows =
    db != null
      ? await db
          .select({
            id: auditLogs.id,
            createdAt: auditLogs.createdAt,
            action: auditLogs.action,
            entityType: auditLogs.entityType,
            entityId: auditLogs.entityId,
            actorType: auditLogs.actorType,
            actorAdminId: auditLogs.actorAdminId,
            actorUserId: auditLogs.actorUserId,
          })
          .from(auditLogs)
          .orderBy(desc(auditLogs.createdAt))
          .limit(200)
      : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Audit logs
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Latest 200 events. Filters, exports, and richer actor labels will
          follow as more modules write to this table.
        </p>
      </div>
      <GlassPanel>
        <AdminAuditTable rows={rows} />
      </GlassPanel>
    </div>
  );
}
