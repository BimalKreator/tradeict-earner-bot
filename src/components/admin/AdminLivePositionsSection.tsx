import { LivePositionsPanel } from "@/components/live-positions/LivePositionsPanel";
import type { AdminLiveOpenPositionRow } from "@/server/queries/live-positions-dashboard";

export function AdminLivePositionsSection({
  initialRows,
}: {
  initialRows: AdminLiveOpenPositionRow[];
}) {
  return <LivePositionsPanel variant="admin" initialRows={initialRows} />;
}
