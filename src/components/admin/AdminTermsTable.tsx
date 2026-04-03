export type AdminTermsRow = {
  version: number;
  title: string | null;
  effectiveFrom: Date;
};

export function AdminTermsTable({ rows }: { rows: AdminTermsRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No terms versions published. Add rows to{" "}
        <code className="text-[var(--accent)]">terms_versions</code> or use a
        future admin editor.
      </p>
    );
  }

  const fmt = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-glass)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-3 pr-4 font-medium">Version</th>
            <th className="pb-3 pr-4 font-medium">Title</th>
            <th className="pb-3 font-medium">Effective from (IST)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.version}
              className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
            >
              <td className="py-3 pr-4 align-top font-mono tabular-nums text-[var(--accent)]">
                v{r.version}
              </td>
              <td className="py-3 pr-4 align-top text-[var(--text-muted)]">
                {r.title ?? "—"}
              </td>
              <td className="py-3 align-top text-[var(--text-muted)]">
                {fmt.format(new Date(r.effectiveFrom))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
