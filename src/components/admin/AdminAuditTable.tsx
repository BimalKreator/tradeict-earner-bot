export type AdminAuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actorAdminId: string | null;
  actorUserId: string | null;
};

const ACTOR_LABELS: Record<string, string> = {
  admin: "Admin",
  user: "User",
  system: "System",
};

export function AdminAuditTable({ rows }: { rows: AdminAuditRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No audit events recorded yet.
      </p>
    );
  }

  const fmt = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-3 pr-4 font-medium">When (IST)</th>
            <th className="pb-3 pr-4 font-medium">Action</th>
            <th className="pb-3 pr-4 font-medium">Entity</th>
            <th className="pb-3 pr-4 font-medium">Entity ID</th>
            <th className="pb-3 font-medium">Actor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
            >
              <td className="py-3 pr-4 align-top text-xs text-[var(--text-muted)]">
                {fmt.format(new Date(r.createdAt))}
              </td>
              <td className="py-3 pr-4 align-top font-mono text-xs">{r.action}</td>
              <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
                {r.entityType}
              </td>
              <td className="py-3 pr-4 align-top font-mono text-xs text-[var(--text-muted)]">
                {r.entityId ?? "—"}
              </td>
              <td className="py-3 align-top text-xs text-[var(--text-muted)]">
                {ACTOR_LABELS[r.actorType] ?? r.actorType}
                {r.actorAdminId ? (
                  <span className="mt-0.5 block truncate max-w-[200px] text-[10px] opacity-80">
                    admin {r.actorAdminId}
                  </span>
                ) : null}
                {r.actorUserId ? (
                  <span className="mt-0.5 block truncate max-w-[200px] text-[10px] opacity-80">
                    user {r.actorUserId}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
