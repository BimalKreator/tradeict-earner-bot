"use client";

import { useState } from "react";

import {
  diffKeys,
  extractOldNewFromMetadata,
  formatAuditValue,
} from "@/components/admin/audit-log-metadata";

export type AdminAuditLogsTableRow = {
  id: string;
  createdAtIst: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityHref: string | null;
  actorLine: string;
  actorDetail: string | null;
  metadata: Record<string, unknown> | null;
};

function DetailModal({
  row,
  onClose,
}: {
  row: AdminAuditLogsTableRow;
  onClose: () => void;
}) {
  const meta = row.metadata;
  const notes =
    meta && typeof meta.notes === "string" && meta.notes.trim()
      ? meta.notes.trim()
      : null;
  const { oldVals, newVals } = extractOldNewFromMetadata(meta);
  const keys = diffKeys(oldVals, newVals);
  const hasPairDiff =
    keys.length > 0 && (oldVals !== null || newVals !== null);

  let jsonPretty = "";
  try {
    jsonPretty = JSON.stringify(meta ?? {}, null, 2);
  } catch {
    jsonPretty = String(meta);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby={`audit-detail-${row.id}`}
        className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--border-glass)] bg-[#0a0c12]/95 shadow-2xl shadow-blue-950/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-glass)] px-4 py-3">
          <div>
            <h2
              id={`audit-detail-${row.id}`}
              className="font-mono text-sm font-semibold text-[var(--text-primary)]"
            >
              Audit details
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {row.action} · {row.entityType}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border-glass)] px-3 py-1 text-xs text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]"
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(90vh-4rem)] overflow-y-auto p-4 text-sm">
          {notes ? (
            <p className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[var(--text-primary)]">
              {notes}
            </p>
          ) : null}

          {hasPairDiff ? (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Before &amp; after
              </h3>
              <div className="overflow-x-auto rounded-lg border border-[var(--border-glass)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-glass)] bg-black/30 text-[var(--text-muted)]">
                      <th className="px-2 py-2 font-medium">Field</th>
                      <th className="px-2 py-2 font-medium">Before</th>
                      <th className="px-2 py-2 font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => {
                      const before = oldVals?.[k];
                      const after = newVals?.[k];
                      const changed =
                        JSON.stringify(before) !== JSON.stringify(after);
                      return (
                        <tr
                          key={k}
                          className={
                            changed
                              ? "border-b border-[var(--border-glass)]/50 bg-amber-500/5"
                              : "border-b border-[var(--border-glass)]/50"
                          }
                        >
                          <td className="px-2 py-1.5 align-top font-mono text-[var(--accent)]">
                            {k}
                          </td>
                          <td className="px-2 py-1.5 align-top font-mono text-[var(--text-muted)]">
                            {formatAuditValue(before)}
                          </td>
                          <td className="px-2 py-1.5 align-top font-mono text-[var(--text-primary)]">
                            {formatAuditValue(after)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Full metadata (JSON)
          </h3>
          <pre className="overflow-x-auto rounded-lg border border-[var(--border-glass)] bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
            {jsonPretty || "{}"}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function AdminAuditLogsTable({ rows }: { rows: AdminAuditLogsTableRow[] }) {
  const [open, setOpen] = useState<AdminAuditLogsTableRow | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No audit events match your filters.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <th className="pb-2 pr-2 font-medium">Timestamp (IST)</th>
              <th className="pb-2 pr-2 font-medium">Admin / actor</th>
              <th className="pb-2 pr-2 font-medium">Action</th>
              <th className="pb-2 pr-2 font-medium">Target entity ID</th>
              <th className="pb-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-[var(--border-glass)]/50 text-[var(--text-primary)]"
              >
                <td className="py-2 pr-2 align-top text-[10px] leading-tight text-[var(--text-muted)]">
                  {r.createdAtIst}
                </td>
                <td className="py-2 pr-2 align-top">
                  <div className="font-medium text-[var(--text-primary)]">
                    {r.actorLine}
                  </div>
                  {r.actorDetail ? (
                    <div className="mt-0.5 max-w-[200px] truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {r.actorDetail}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-2 align-top font-mono text-[10px] text-[var(--accent)]">
                  {r.action}
                  <div className="mt-0.5 font-sans text-[9px] text-[var(--text-muted)]">
                    {r.entityType}
                  </div>
                </td>
                <td className="py-2 pr-2 align-top font-mono text-[10px]">
                  {r.entityHref && r.entityId ? (
                    <a
                      href={r.entityHref}
                      className="text-[var(--accent)] underline decoration-blue-500/40 underline-offset-2 hover:opacity-90"
                    >
                      {r.entityId}
                    </a>
                  ) : (
                    <span className="text-[var(--text-muted)]">
                      {r.entityId ?? "—"}
                    </span>
                  )}
                </td>
                <td className="py-2 align-top">
                  <button
                    type="button"
                    onClick={() => setOpen(r)}
                    className="rounded-md border border-[var(--border-glass)] bg-white/5 px-2 py-1 text-[10px] font-semibold text-[var(--accent)] hover:bg-white/10"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? <DetailModal row={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
