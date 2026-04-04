import { AdminAuditLogsTable } from "@/components/admin/AdminAuditLogsTable";
import { AdminAuditLogsToolbar } from "@/components/admin/AdminAuditLogsToolbar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { resolveAuditEntityLink } from "@/server/audit/audit-entity-links";
import {
  getAdminAuditLogsPaged,
  listAdminsForAuditFilter,
  type AdminAuditLogListRow,
} from "@/server/queries/admin-audit-logs";

export const metadata = {
  title: "Audit logs",
};

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function parseYmd(raw: string | undefined): string | undefined {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return undefined;
}

function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function formatAuditTimestampIst(d: Date): string {
  const wall = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(d);
  return `${wall} IST`;
}

function mapRowForTable(r: AdminAuditLogListRow) {
  let actorLine = r.actorType;
  let actorDetail: string | null = null;
  if (r.actorType === "admin") {
    actorLine = r.adminName?.trim() || "Admin";
    actorDetail = r.adminEmail ?? r.actorAdminId;
  } else if (r.actorType === "user") {
    actorLine = "User";
    actorDetail = r.actorUserId;
  } else if (r.actorType === "system") {
    actorLine = "System";
    actorDetail = null;
  }

  const entityHref = resolveAuditEntityLink(
    r.entityType,
    r.entityId,
    r.metadata,
  );

  return {
    id: r.id,
    createdAtIst: formatAuditTimestampIst(r.createdAt),
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    entityHref,
    actorLine,
    actorDetail,
    metadata: r.metadata,
  };
}

export default async function AdminAuditLogsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};

  const dateFrom = parseYmd(pick(sp, "dateFrom"));
  const dateTo = parseYmd(pick(sp, "dateTo"));
  const actorAdminId = pick(sp, "adminId");
  const action = pick(sp, "action");
  const entityIdQ = pick(sp, "entityQ");
  const page = parsePage(pick(sp, "page"));

  const [adminOptions, paged] = await Promise.all([
    listAdminsForAuditFilter(),
    getAdminAuditLogsPaged({
      dateFromIst: dateFrom,
      dateToIst: dateTo,
      actorAdminId,
      action,
      entityIdQ,
      page,
    }),
  ]);

  if (!paged) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        Database is not configured or unavailable.
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(paged.total / paged.pageSize));
  const rows = paged.rows.map(mapRowForTable);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Audit logs
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Administrative and system events with filters, pagination, and
          before/after metadata. Timestamps use{" "}
          <strong className="text-[var(--text-primary)]">Asia/Kolkata</strong>.
        </p>
      </div>
      <GlassPanel>
        <div className="space-y-4">
          <AdminAuditLogsToolbar
            adminOptions={adminOptions}
            values={{
              dateFrom: pick(sp, "dateFrom") ?? "",
              dateTo: pick(sp, "dateTo") ?? "",
              actorAdminId: pick(sp, "adminId") ?? "",
              action: pick(sp, "action") ?? "",
              entityIdQ: pick(sp, "entityQ") ?? "",
              page: paged.page,
              totalPages,
            }}
          />
          <p className="text-[11px] text-[var(--text-muted)]">
            Showing {rows.length} of {paged.total} matching rows (page size{" "}
            {paged.pageSize}).
          </p>
          <AdminAuditLogsTable rows={rows} />
        </div>
      </GlassPanel>
    </div>
  );
}
