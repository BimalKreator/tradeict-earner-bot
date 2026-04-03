import {
  sortChartPoints,
  validatePerformanceChartPayload,
} from "@/lib/strategy-performance-chart";

type Props = {
  slug: string;
  data: unknown;
};

const safeId = (slug: string) =>
  `chart-${slug.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/**
 * Compact sparkline for strategy cards; subtle placeholder when missing/invalid.
 */
export function UserStrategySparkline({ slug, data }: Props) {
  const parsed = validatePerformanceChartPayload(data);
  if (!parsed.ok || parsed.points.length === 0) {
    return (
      <div className="flex min-h-[76px] items-center justify-center rounded-xl border border-white/[0.06] bg-black/25 px-3">
        <p className="text-center text-xs text-[var(--text-muted)]/75">
          Chart data pending
        </p>
      </div>
    );
  }

  const sorted = sortChartPoints(parsed.points);
  const values = sorted.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const pad = 6;
  const w = 280;
  const h = 72;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const span = maxV - minV || 1;
  const gid = safeId(slug);

  const pts = sorted.map((p, i) => {
    const x = pad + (i / Math.max(sorted.length - 1, 1)) * innerW;
    const y = pad + innerH - ((p.value - minV) / span) * innerH;
    return `${x},${y}`;
  });
  const line = pts.join(" ");

  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/25 px-2 py-2">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[72px] w-full text-sky-400/90"
        aria-hidden
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(56, 189, 248)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(56, 189, 248)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={line}
        />
        <polygon
          fill={`url(#${gid})`}
          points={`${pad},${pad + innerH} ${line} ${pad + innerW},${pad + innerH}`}
          opacity={0.85}
        />
      </svg>
    </div>
  );
}
