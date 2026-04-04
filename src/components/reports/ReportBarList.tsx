"use client";

import { useMemo } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount, formatUsdAmount } from "@/lib/format-inr";

export function ReportBarList({
  title,
  hint,
  rows,
  valueMode = "inr",
}: {
  title: string;
  hint: string;
  rows: { label: string; valueInr: string; sub?: string }[];
  /** `percent` treats `valueInr` as 0–100 for bar width; displays with % suffix. */
  valueMode?: "inr" | "usd" | "percent";
}) {
  const { maxAbs, items } = useMemo(() => {
    const vals = rows.map((r) => Math.abs(Number(r.valueInr) || 0));
    const m =
      valueMode === "percent"
        ? 100
        : Math.max(1, ...vals);
    return {
      maxAbs: m,
      items: rows.map((r) => {
        const n = Number(r.valueInr) || 0;
        const abs = Math.abs(n);
        const pct = valueMode === "percent" ? Math.min(100, abs) : (abs / m) * 100;
        return { ...r, n, pct };
      }),
    };
  }, [rows, valueMode]);

  if (rows.length === 0) {
    return (
      <GlassPanel className="!p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {title}
        </p>
        <p className="mt-2 text-sm text-[var(--text-muted)]">No rows.</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="!p-5">
      <div className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {title}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{hint}</p>
      </div>
      <ul className="space-y-3">
        {items.map((r) => (
          <li key={r.label + (r.sub ?? "")}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-[var(--text-primary)]" title={r.label}>
                {r.label}
              </span>
              <span
                className={
                  valueMode === "percent"
                    ? "shrink-0 text-sky-200"
                    : r.n >= 0
                      ? "shrink-0 text-emerald-200"
                      : "shrink-0 text-rose-200"
                }
              >
                {valueMode === "percent"
                  ? `${r.n.toFixed(1)}%`
                  : valueMode === "usd"
                    ? formatUsdAmount(r.n)
                    : formatInrAmount(r.n)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full rounded-full ${
                  valueMode === "percent"
                    ? "bg-emerald-500/70"
                    : r.n >= 0
                      ? "bg-sky-500/70"
                      : "bg-rose-500/70"
                }`}
                style={{ width: `${r.pct}%` }}
              />
            </div>
            {r.sub ? (
              <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{r.sub}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {valueMode === "inr" || valueMode === "usd" ? (
        <p className="mt-3 text-[10px] text-[var(--text-muted)]">
          Scale max |value| in view:{" "}
          {valueMode === "usd"
            ? formatUsdAmount(maxAbs)
            : formatInrAmount(maxAbs)}
        </p>
      ) : null}
    </GlassPanel>
  );
}
