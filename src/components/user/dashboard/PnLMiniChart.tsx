"use client";

import { useMemo } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";

function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function PnLMiniChart({
  title,
  series,
}: {
  title: string;
  series: { date: string; pnlInr: string }[];
}) {
  const { points, min, max, pathD, areaD } = useMemo(() => {
    const vals = series.map((s) => Number(s.pnlInr) || 0);
    const minV = Math.min(0, ...vals);
    const maxV = Math.max(0, ...vals);
    const pad = maxV === minV ? 1 : (maxV - minV) * 0.08;
    const lo = minV - pad;
    const hi = maxV + pad;
    const w = 320;
    const h = 120;
    const n = Math.max(series.length, 1);
    const pts = series.map((s, i) => {
      const x = n <= 1 ? w / 2 : (i / (n - 1)) * w;
      const v = Number(s.pnlInr) || 0;
      const y = h - ((v - lo) / (hi - lo || 1)) * h;
      return { x, y, v, date: s.date };
    });
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = `M 0 ${h} ${pts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")} L ${w} ${h} Z`;
    return { points: pts, min: lo, max: hi, pathD: line, areaD: area };
  }, [series]);

  return (
    <GlassPanel className="!p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {title}
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            Last 7 IST calendar days · sums realized PnL
          </p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          Low {formatInr(min)} → High {formatInr(max)}
        </span>
      </div>
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox="0 0 320 120"
          className="h-32 w-full min-w-[280px]"
          preserveAspectRatio="none"
          role="img"
          aria-label="PnL trend chart"
        >
          <defs>
            <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(56, 189, 248)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="rgb(56, 189, 248)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#pnlFill)" />
          <path
            d={pathD}
            fill="none"
            stroke="rgb(56, 189, 248)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3}
              className="fill-[var(--accent)]"
            />
          ))}
        </svg>
      </div>
      <div className="mt-2 flex justify-between gap-1 text-[10px] text-[var(--text-muted)]">
        {series.map((s) => (
          <span key={s.date} className="truncate text-center" title={s.date}>
            {s.date.slice(5)}
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}
