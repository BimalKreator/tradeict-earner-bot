import Link from "next/link";

export type AdminTermsVersionRow = {
  id: string;
  versionName: string;
  status: "draft" | "published" | "archived";
  publishedAt: Date | null;
  updatedAt: Date;
};

const BADGE: Record<
  AdminTermsVersionRow["status"],
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-slate-500/20 text-slate-200",
  },
  published: {
    label: "Published",
    className: "bg-emerald-500/20 text-emerald-200",
  },
  archived: {
    label: "Archived",
    className: "bg-amber-500/20 text-amber-200",
  },
};

export function AdminTermsVersionsTable({ rows }: { rows: AdminTermsVersionRow[] }) {
  const fmt = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  if (rows.length === 0) {
    return (
      <div className="space-y-3 text-sm text-[var(--text-muted)]">
        <p>No terms versions yet. Create a draft to get started.</p>
        <Link
          href="/admin/terms/new"
          className="inline-block rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
        >
          New version
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-3 pr-4 font-medium">Version name</th>
            <th className="pb-3 pr-4 font-medium">Status</th>
            <th className="pb-3 pr-4 font-medium">Published (IST)</th>
            <th className="pb-3 pr-4 font-medium">Updated (IST)</th>
            <th className="pb-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = BADGE[r.status];
            return (
              <tr
                key={r.id}
                className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
              >
                <td className="py-3 pr-4 align-top font-medium">{r.versionName}</td>
                <td className="py-3 pr-4 align-top">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${b.className}`}
                  >
                    {b.label}
                  </span>
                </td>
                <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
                  {r.publishedAt ? fmt.format(new Date(r.publishedAt)) : "—"}
                </td>
                <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
                  {fmt.format(new Date(r.updatedAt))}
                </td>
                <td className="py-3 align-top text-right">
                  <Link
                    href={`/admin/terms/${r.id}/edit`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
