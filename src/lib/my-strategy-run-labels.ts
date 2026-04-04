import type { InferSelectModel } from "drizzle-orm";

import type { userStrategyRuns } from "@/server/db/schema";

type UserStrategyRunStatus = InferSelectModel<typeof userStrategyRuns>["status"];

const LABELS: Record<UserStrategyRunStatus, string> = {
  inactive: "Inactive",
  active: "Active",
  paused: "Paused",
  paused_revenue_due: "Paused — revenue due",
  paused_exchange_off: "Paused — exchange",
  paused_insufficient_funds: "Paused — insufficient margin",
  paused_admin: "Paused — admin",
  expired: "Expired",
  blocked_revenue_due: "Blocked — revenue due",
  ready_to_activate: "Ready to activate",
  paused_by_user: "Paused by you",
};

export function runStatusLabel(status: UserStrategyRunStatus): string {
  return LABELS[status] ?? status;
}
