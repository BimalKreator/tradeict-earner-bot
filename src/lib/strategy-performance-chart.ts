export type StrategyChartPoint = { date: string; value: number };

export function validatePerformanceChartPayload(data: unknown):
  | { ok: true; points: StrategyChartPoint[] }
  | { ok: false; error: string } {
  if (!Array.isArray(data)) {
    return { ok: false, error: "Performance chart must be a JSON array." };
  }
  const points: StrategyChartPoint[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `Item ${i + 1} must be an object.` };
    }
    const rec = row as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, "date")) {
      return { ok: false, error: `Item ${i + 1} is missing "date".` };
    }
    if (!Object.prototype.hasOwnProperty.call(rec, "value")) {
      return { ok: false, error: `Item ${i + 1} is missing "value".` };
    }
    if (typeof rec.date !== "string" || rec.date.trim() === "") {
      return {
        ok: false,
        error: `Item ${i + 1}: "date" must be a non-empty string.`,
      };
    }
    if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) {
      return {
        ok: false,
        error: `Item ${i + 1}: "value" must be a finite number.`,
      };
    }
    points.push({ date: rec.date.trim(), value: rec.value });
  }
  return { ok: true, points };
}

export function parsePerformanceChartJsonText(raw: string):
  | { ok: true; points: StrategyChartPoint[] }
  | { ok: false; error: string } {
  const t = raw.trim();
  if (t === "") {
    return { ok: true, points: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(t) as unknown;
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }
  return validatePerformanceChartPayload(parsed);
}

/** Sort by date string (ISO / YYYY-MM-DD lexical sort). */
export function sortChartPoints(points: StrategyChartPoint[]): StrategyChartPoint[] {
  return [...points].sort((a, b) =>
    a.date.localeCompare(b.date, undefined, { sensitivity: "base" }),
  );
}

export function chartPointsToDbValue(
  points: StrategyChartPoint[],
): StrategyChartPoint[] | null {
  return points.length === 0 ? null : points;
}

export function formatChartPointsForTextarea(
  value: StrategyChartPoint[] | null | undefined,
): string {
  if (!value || value.length === 0) {
    return "[]";
  }
  return JSON.stringify(sortChartPoints(value), null, 2);
}
