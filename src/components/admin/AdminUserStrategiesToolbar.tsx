import type { AdminStrategyListRow } from "@/server/queries/admin-strategies";
import type { AdminUserStrategyRunBucket } from "@/server/queries/admin-user-strategies";

const BUCKETS: { value: AdminUserStrategyRunBucket; label: string }[] = [
  { value: "all", label: "All runs" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "expired", label: "Expired / access ended" },
  { value: "blocked", label: "Revenue blocked" },
];

export function AdminUserStrategiesToolbar(props: {
  q: string;
  strategyId: string;
  runBucket: AdminUserStrategyRunBucket;
  expFrom: string;
  expTo: string;
  strategies: AdminStrategyListRow[];
}) {
  const { q, strategyId, runBucket, expFrom, expTo, strategies } = props;

  return (
    <form
      method="get"
      className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
        User email / name
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search"
          className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <label className="flex min-w-[160px] flex-col gap-1 text-xs text-[var(--text-muted)]">
        Strategy
        <select
          name="strategyId"
          defaultValue={strategyId}
          className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">All strategies</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[160px] flex-col gap-1 text-xs text-[var(--text-muted)]">
        Run bucket
        <select
          name="runBucket"
          defaultValue={runBucket}
          className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          {BUCKETS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
        Access until from
        <input
          type="date"
          name="expFrom"
          defaultValue={expFrom}
          className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <label className="flex min-w-[140px] flex-col gap-1 text-xs text-[var(--text-muted)]">
        Access until to
        <input
          type="date"
          name="expTo"
          defaultValue={expTo}
          className="rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
      >
        Apply
      </button>
    </form>
  );
}
