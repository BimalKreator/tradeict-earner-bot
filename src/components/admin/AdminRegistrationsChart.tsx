"use client";

import { useMemo } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import type { AdminRegistrationDay } from "@/server/queries/admin-dashboard";

/**
 * Column chart — new user registrations by IST calendar day (last 7 days).
 */
export function AdminRegistrationsChart({
  series,
}: {
  series: AdminRegistrationDay[];
}) {
  const layout = useMemo(() => {
    const W = 320;
    const H = 110;
    const padL = 8;
    const padR = 8;
    const padB = 22;
    const chartW = W - padL - padR;
    const chartH = H - padB;
    const n = Math.max(series.length, 1);
    const slot = chartW / n;
    const maxC = Math.max(1, ...series.map((s) => s.count));
    const bars = series.map((s, i) => {
      const bw = Math.max(6, slot * 0.55);
      const x = padL + i * slot + (slot - bw) / 2;
      const bh = (s.count / maxC) * chartH;
      const y = chartH - bh;
      return { x, y, w: bw, h: bh, ...s };
    });
    return { W, H, maxC, bars };
  }, [series]);

  return (
    <GlassPanel className="!p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        New registrations (7 days, IST)
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
        Users created per Asia/Kolkata calendar day · peak {layout.maxC} in window
      </p>
      <svg
        viewBox={`0 0 ${layout.W} ${layout.H}`}
        className="mt-4 h-32 w-full"
        role="img"
        aria-label="Registration counts by IST day"
      >
        {layout.bars.map((b) => (
          <g key={b.date}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={Math.max(b.h, 1)}
              rx={3}
              className="fill-[var(--accent)]/50 stroke-[var(--accent)]/35"
              strokeWidth={1}
            />
            <text
              x={b.x + b.w / 2}
              y={layout.H - 4}
              textAnchor="middle"
              className="fill-[var(--text-muted)] text-[9px]"
            >
              {b.date.slice(5)}
            </text>
          </g>
        ))}
      </svg>
    </GlassPanel>
  );
}
