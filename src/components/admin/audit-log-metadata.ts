/** Normalize historical audit shapes into old/new maps for the diff UI. */
export function extractOldNewFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): {
  oldVals: Record<string, unknown> | null;
  newVals: Record<string, unknown> | null;
} {
  if (!metadata) return { oldVals: null, newVals: null };
  const rawOld = metadata.old_values ?? metadata.before;
  const rawNew = metadata.new_values ?? metadata.after;
  const oldVals =
    rawOld && typeof rawOld === "object" && !Array.isArray(rawOld)
      ? (rawOld as Record<string, unknown>)
      : null;
  const newVals =
    rawNew && typeof rawNew === "object" && !Array.isArray(rawNew)
      ? (rawNew as Record<string, unknown>)
      : null;
  return { oldVals, newVals };
}

export function diffKeys(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): string[] {
  const s = new Set<string>();
  if (a) for (const k of Object.keys(a)) s.add(k);
  if (b) for (const k of Object.keys(b)) s.add(k);
  return [...s].sort();
}

export function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
