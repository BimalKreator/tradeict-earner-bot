import { listAuditActionFilterOptions } from "@/server/queries/admin-audit-logs";

function buildHref(base: Record<string, string>, page: number): string {
  const p = new URLSearchParams({ ...base, page: String(page) });
  const qs = p.toString();
  return qs ? `/admin/audit-logs?${qs}` : "/admin/audit-logs";
}

export function AdminAuditLogsToolbar(props: {
  adminOptions: { id: string; email: string; name: string }[];
  values: {
    dateFrom: string;
    dateTo: string;
    actorAdminId: string;
    action: string;
    entityIdQ: string;
    page: number;
    totalPages: number;
  };
}) {
  const { adminOptions, values: v } = props;
  const base: Record<string, string> = {};
  if (v.dateFrom) base.dateFrom = v.dateFrom;
  if (v.dateTo) base.dateTo = v.dateTo;
  if (v.actorAdminId) base.adminId = v.actorAdminId;
  if (v.action) base.action = v.action;
  if (v.entityIdQ) base.entityQ = v.entityIdQ;

  const actions = listAuditActionFilterOptions();

  return (
    <div className="space-y-4">
      <form
        method="get"
        className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-end"
      >
        <input type="hidden" name="page" value="1" />
        <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          From (IST date)
          <input
            type="date"
            name="dateFrom"
            defaultValue={v.dateFrom}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          To (IST date)
          <input
            type="date"
            name="dateTo"
            defaultValue={v.dateTo}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[200px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          Admin actor
          <select
            name="adminId"
            defaultValue={v.actorAdminId}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">All admins</option>
            {adminOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
          Action type
          <select
            name="action"
            defaultValue={v.action}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">All actions</option>
            {actions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
          Target entity ID
          <input
            type="search"
            name="entityQ"
            defaultValue={v.entityIdQ}
            placeholder="UUID or partial"
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 font-mono text-sm text-[var(--text-primary)]"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {v.totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>
            Page {v.page} / {v.totalPages}
          </span>
          {v.page > 1 ? (
            <a
              href={buildHref(base, v.page - 1)}
              className="rounded-md border border-[var(--border-glass)] px-2 py-1 text-[var(--accent)] hover:bg-white/5"
            >
              Previous
            </a>
          ) : null}
          {v.page < v.totalPages ? (
            <a
              href={buildHref(base, v.page + 1)}
              className="rounded-md border border-[var(--border-glass)] px-2 py-1 text-[var(--accent)] hover:bg-white/5"
            >
              Next
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
