import type { StrategyExecutionSignal } from "./signals/types";

/**
 * Execution semantics for revenue-share gating.
 * - `entry`: opens or adds to a position (blocked when run is `blocked_revenue_due`).
 * - `exit`: closes or reduces a position (still allowed under block).
 *
 * Sources (first match wins):
 * 1. `signal.actionType` (canonical on the DTO)
 * 2. `signal.metadata.action_type` (snake_case, common in JSON providers)
 * 3. `signal.metadata.actionType` (camelCase)
 *
 * **Default `entry`** — safest when the provider omits the field (avoid opening
 * positions under a revenue block by accident).
 */
export type StrategySignalAction = "entry" | "exit";

function pickRaw(
  signal: StrategyExecutionSignal,
): string | undefined {
  const top = (signal as { actionType?: unknown }).actionType;
  if (typeof top === "string" && top.trim()) return top.trim();
  const m = signal.metadata;
  if (!m || typeof m !== "object") return undefined;
  const rec = m as Record<string, unknown>;
  const snake = rec.action_type;
  if (typeof snake === "string" && snake.trim()) return snake.trim();
  const camel = rec.actionType;
  if (typeof camel === "string" && camel.trim()) return camel.trim();
  return undefined;
}

export function normalizeStrategySignalAction(
  signal: StrategyExecutionSignal,
): StrategySignalAction {
  const raw = pickRaw(signal)?.toLowerCase();
  if (raw === "exit" || raw === "close" || raw === "flatten") return "exit";
  if (raw === "entry" || raw === "open") return "entry";
  return "entry";
}
