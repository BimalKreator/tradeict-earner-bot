import { sortChartPoints, type StrategyChartPoint } from "@/lib/strategy-performance-chart";

type Props = {
  points: StrategyChartPoint[] | null | undefined;
  className?: string;
};

/**
 * Minimal SVG sparkline for admin preview (IST-agnostic: uses point order after date sort).
 */
export function StrategyPerformanceChartPreview({ points, className }: Props) {
  const sorted = sortChartPoints(points ?? []);
  if (sorted.length === 0) {
    return (
      <p className={`text-sm text-[var(--text-muted)] ${className ?? ""}`}>
        No chart points. Add JSON in the edit form.
      </p>
    );
  }

  const values = sorted.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const pad = 8;
  const w = 360;
  const h = 120;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const span = maxV - minV || 1;

  const pts = sorted.map((p, i) => {
    const x = pad + (i / Math.max(sorted.length - 1, 1)) * innerW;
    const y = pad + innerH - ((p.value - minV) / span) * innerH;
    return `${x},${y}`;
  });

  const polyline = pts.join(" ");

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full max-w-md overflow-visible text-[var(--accent)]"
        aria-hidden
      >
        <defs>
          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(56, 189, 248)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(56, 189, 248)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
        />
        <polygon
          fill="url(#chartFill)"
          points={`${pad},${pad + innerH} ${polyline} ${pad + innerW},${pad + innerH}`}
          opacity={0.9}
        />
      </svg>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {sorted.length} point{sorted.length === 1 ? "" : "s"} · min{" "}
        {minV.toFixed(4)} · max {maxV.toFixed(4)}
      </p>
    </div>
  );
}
