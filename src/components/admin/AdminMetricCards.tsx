type Metric = {
  label: string;
  value: string;
  sublabel?: string;
};

export function AdminMetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="rounded-2xl border border-[var(--border-glass)] bg-[rgba(3,7,18,0.55)] p-5 shadow-[0_0_0_1px_rgba(56,189,248,0.06)] backdrop-blur-md"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {m.label}
          </p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {m.value}
          </p>
          {m.sublabel ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{m.sublabel}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
