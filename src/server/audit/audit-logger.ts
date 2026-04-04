import { auditLogs } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { requireDb } from "@/server/db/require-db";

import type { AuditAction, AuditEntityType } from "./audit-catalog";

/**
 * Drizzle transactions are not assignable to `Database` in strict mode; callers pass `tx`
 * and we cast internally (insert API is compatible).
 */
type DbOrTx = unknown;

function buildMetadata(params: {
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  notes?: string | null;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(params.extra ?? {}) };
  if (params.oldValues != null && Object.keys(params.oldValues).length > 0) {
    out.old_values = params.oldValues;
  }
  if (params.newValues != null && Object.keys(params.newValues).length > 0) {
    out.new_values = params.newValues;
  }
  if (params.notes != null && params.notes.trim() !== "") {
    out.notes = params.notes.trim();
  }
  return out;
}

export type LogAuditEventParams = {
  actorType: "admin" | "system" | "user";
  actorAdminId?: string | null;
  actorUserId?: string | null;
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  /** When set, insert inside the caller's transaction. */
  tx?: DbOrTx;
};

/**
 * Low-level writer for `audit_logs`. Prefer {@link logAdminAction} for staff actions.
 */
export async function logAuditEvent(params: LogAuditEventParams): Promise<void> {
  const dbx = (params.tx ?? requireDb()) as Database;
  await dbx.insert(auditLogs).values({
    actorType: params.actorType,
    actorAdminId: params.actorAdminId ?? null,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    metadata: params.metadata ?? {},
    ipAddress: params.ipAddress ?? null,
  });
}

export type LogAdminActionParams = {
  actorAdminId: string;
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  notes?: string | null;
  /** Additional metadata keys (merged after old_values / new_values / notes). */
  extra?: Record<string, unknown> | null;
  ipAddress?: string | null;
  tx?: DbOrTx;
};

/**
 * Unified helper for administrative actions (`actor_type = admin`).
 */
export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  await logAuditEvent({
    actorType: "admin",
    actorAdminId: params.actorAdminId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: buildMetadata({
      oldValues: params.oldValues,
      newValues: params.newValues,
      notes: params.notes,
      extra: params.extra,
    }),
    ipAddress: params.ipAddress,
    tx: params.tx,
  });
}
