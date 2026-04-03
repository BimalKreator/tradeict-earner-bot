import type { ReactNode } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "default" | "positive" | "negative";
}) {
  const accentClass =
    accent === "positive"
      ? "text-emerald-400"
      : accent === "negative"
        ? "text-[var(--danger)]"
        : "text-[var(--text-primary)]";

  return (
    <GlassPanel className="!p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className={`mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums ${accentClass}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </GlassPanel>
  );
}
