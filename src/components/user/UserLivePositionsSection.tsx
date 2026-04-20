import { LivePositionsPanel } from "@/components/live-positions/LivePositionsPanel";
import type { LiveOpenPositionRow } from "@/server/queries/live-positions-dashboard";

export function UserLivePositionsSection({
  initialRows,
}: {
  initialRows: LiveOpenPositionRow[];
}) {
  return <LivePositionsPanel variant="user" initialRows={initialRows} />;
}
