import { and, asc, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/server/db";
import { admins, auditLogs } from "@/server/db/schema";

import { AUDIT_ACTIONS } from "@/server/audit/audit-catalog";

export type AdminAuditLogListRow = {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actorAdminId: string | null;
  actorUserId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  metadata: Record<string, unknown> | null;
};

export type AdminAuditLogFilters = {
  dateFromIst?: string;
  dateToIst?: string;
  actorAdminId?: string;
  action?: string;
  entityIdQ?: string;
  page: number;
};

const PAGE_SIZE_DEFAULT = 40;
const PAGE_SIZE_MAX = 100;

function assertYmd(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function assertUuid(s: string | undefined): s is string {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function isUuidString(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export function listAuditActionFilterOptions(): readonly string[] {
  return AUDIT_ACTIONS;
}

export async function listAdminsForAuditFilter(): Promise<
  { id: string; email: string; name: string }[]
> {
  if (!db) return [];
  return db
    .select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
    })
    .from(admins)
    .where(isNull(admins.deletedAt))
    .orderBy(asc(admins.email));
}

export async function getAdminAuditLogsPaged(
  filters: AdminAuditLogFilters,
  pageSize: number = PAGE_SIZE_DEFAULT,
): Promise<{
  rows: AdminAuditLogListRow[];
  total: number;
  page: number;
  pageSize: number;
} | null> {
  if (!db) return null;

  const ps = Math.min(Math.max(pageSize, 1), PAGE_SIZE_MAX);
  const page = Math.max(1, filters.page);
  const offset = (page - 1) * ps;

  const conditions: SQL[] = [sql`true`];

  if (assertYmd(filters.dateFromIst)) {
    conditions.push(
      sql`(timezone('Asia/Kolkata', ${auditLogs.createdAt}))::date >= ${filters.dateFromIst}::date`,
    );
  }
  if (assertYmd(filters.dateToIst)) {
    conditions.push(
      sql`(timezone('Asia/Kolkata', ${auditLogs.createdAt}))::date <= ${filters.dateToIst}::date`,
    );
  }

  if (assertUuid(filters.actorAdminId)) {
    conditions.push(eq(auditLogs.actorAdminId, filters.actorAdminId));
  }

  if (filters.action?.trim()) {
    conditions.push(eq(auditLogs.action, filters.action.trim()));
  }

  if (filters.entityIdQ?.trim()) {
    const raw = filters.entityIdQ.trim().slice(0, 80);
    if (isUuidString(raw)) {
      conditions.push(eq(auditLogs.entityId, raw));
    } else {
      const p = `%${raw.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      conditions.push(
        sql`COALESCE(${auditLogs.entityId}::text, '') ILIKE ${p}`,
      );
    }
  }

  const whereClause = and(...conditions);

  const [countRow] = await db
    .select({ c: count() })
    .from(auditLogs)
    .where(whereClause);

  const total = Number(countRow?.c ?? 0);

  const rowsRaw = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      actorType: auditLogs.actorType,
      actorAdminId: auditLogs.actorAdminId,
      actorUserId: auditLogs.actorUserId,
      metadata: auditLogs.metadata,
      adminEmail: admins.email,
      adminName: admins.name,
    })
    .from(auditLogs)
    .leftJoin(admins, eq(auditLogs.actorAdminId, admins.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(ps)
    .offset(offset);

  const rows: AdminAuditLogListRow[] = rowsRaw.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actorType: r.actorType,
    actorAdminId: r.actorAdminId,
    actorUserId: r.actorUserId,
    adminEmail: r.adminEmail,
    adminName: r.adminName,
    metadata: r.metadata ?? null,
  }));

  return { rows, total, page, pageSize: ps };
}
