import Link from "next/link";

export type AdminRevenueToolbarProps = {
  week: string;
  q: string;
  billing: "all" | "blocked" | "clean";
  sort: string;
  dir: string;
  weekOptions: string[];
};

function buildSortHref(base: AdminRevenueToolbarProps, nextSort: string): string {
  const p = new URLSearchParams();
  if (base.week) p.set("week", base.week);
  if (base.q) p.set("q", base.q);
  if (base.billing !== "all") p.set("billing", base.billing);

  const same = base.sort === nextSort;
  const nextDir = same
    ? base.dir === "asc"
      ? "desc"
      : "asc"
    : nextSort === "user"
      ? "asc"
      : "desc";

  p.set("sort", nextSort);
  p.set("dir", nextDir);
  const qs = p.toString();
  return `/admin/revenue?${qs}`;
}

export function AdminRevenueToolbar(props: AdminRevenueToolbarProps) {
  const { week, q, billing, sort, dir, weekOptions } = props;

  return (
    <div className="space-y-4">
      <form
        method="get"
        className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
      >
        <label className="flex min-w-[200px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          IST billing week (Mon)
          <select
            name="week"
            defaultValue={week}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">All weeks</option>
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
          User email contains
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="user@example.com"
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs text-[var(--text-muted)]">
          Billing health
          <select
            name="billing"
            defaultValue={billing}
            className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All users</option>
            <option value="blocked">Blocked (revenue due)</option>
            <option value="clean">Clean</option>
          </select>
        </label>
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)]/90 px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent)]"
        >
          Apply filters
        </button>
      </form>

      <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
        <span className="self-center font-medium uppercase tracking-wide">Sort</span>
        {(
          [
            ["week", "Week"],
            ["user", "User"],
            ["outstanding", "Outstanding"],
            ["status", "Status"],
          ] as const
        ).map(([key, label]) => {
          const active = sort === key;
          const href = buildSortHref(props, key);
          return (
            <Link
              key={key}
              href={href}
              className={`rounded-lg border px-2.5 py-1 font-medium transition-colors ${
                active
                  ? "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--text-primary)]"
                  : "border-[var(--border-glass)] bg-white/5 hover:bg-white/10"
              }`}
            >
              {label}
              {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
