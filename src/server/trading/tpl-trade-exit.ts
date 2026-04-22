import { eq } from "drizzle-orm";

import { isTrendProfitLockScalpingStrategySlug } from "@/lib/trend-profit-lock-config";
import { db } from "@/server/db";
import { strategies, userStrategyRuns, type TradingExecutionJobPayload } from "@/server/db/schema";
import { tradingLog } from "@/server/trading/trading-log";

export type TplTradeExitReason =
  | "d1_stoploss_hit"
  | "d1_target_hit"
  | "d1_venue_exit_unknown"
  | "d2_step_target_hit"
  | "d2_step_stoploss_hit"
  | "manual_close"
  | "wipeout_triggered"
  | "venue_automated_exit";

const UI_HINT_KEY = "lastTplTradeExitUi";

export type TplTradeExitUiHint = {
  reason: TplTradeExitReason | string;
  at: string;
  leg?: string;
};

export function humanizeTplExitReason(reason: string): string {
  const map: Record<string, string> = {
    d1_stoploss_hit: "D1 stop loss hit",
    d1_target_hit: "D1 target hit",
    d1_venue_exit_unknown: "D1 closed on venue",
    d2_step_target_hit: "D2 step target hit",
    d2_step_stoploss_hit: "D2 step stop loss hit",
    manual_close: "Manual close",
    wipeout_triggered: "D1 closed — D2 wipeout flatten",
    venue_automated_exit: "Automated exit on venue",
    venue_flat_manual_close: "Manual close (venue already flat)",
    unknown: "Position closed",
  };
  return map[reason] ?? reason.replace(/_/g, " ");
}

export function inferD1TplExitReasonFromMark(
  mark: number,
  d1: { side: "LONG" | "SHORT"; targetPrice: number; stoplossPrice: number },
): "d1_target_hit" | "d1_stoploss_hit" | "d1_venue_exit_unknown" {
  const { side, targetPrice, stoplossPrice } = d1;
  const hitT = side === "LONG" ? mark >= targetPrice : mark <= targetPrice;
  const hitS = side === "LONG" ? mark <= stoplossPrice : mark >= stoplossPrice;
  if (hitT) return "d1_target_hit";
  if (hitS) return "d1_stoploss_hit";
  return "d1_venue_exit_unknown";
}

export function inferTplExitReasonFromExitJobPayload(
  p: TradingExecutionJobPayload,
): TplTradeExitReason {
  const meta =
    p.signalMetadata != null && typeof p.signalMetadata === "object"
      ? (p.signalMetadata as Record<string, unknown>)
      : {};
  const cid = (p.correlationId ?? "").toLowerCase();
  if (typeof meta.manual_close_request_id === "string" && meta.manual_close_request_id.length > 0) {
    return "manual_close";
  }
  if (cid.startsWith("manual_close_real_")) return "manual_close";
  if (cid.startsWith("tpl_d2_flatten_")) return "wipeout_triggered";
  const emergency = meta.manual_emergency_close === true;
  const anchor = meta.reason === "d1_anchor_closed" || meta.leg === "d2_flatten_all";
  if (emergency && anchor) return "wipeout_triggered";
  if (emergency) return "manual_close";
  return "venue_automated_exit";
}

export function logTplTradeExited(params: {
  reason: TplTradeExitReason | string;
  runId: string;
  userId?: string | null;
  strategyId?: string | null;
  symbol?: string | null;
  leg?: string | null;
  extra?: Record<string, unknown>;
}): void {
  tradingLog("info", "tpl_trade_exited", {
    event: "tpl_trade_exited",
    reason: params.reason,
    runId: params.runId,
    userId: params.userId ?? null,
    strategyId: params.strategyId ?? null,
    symbol: params.symbol ?? null,
    leg: params.leg ?? null,
    ...(params.extra ?? {}),
  });
}

export async function persistTplTradeExitUiHint(
  runId: string,
  hint: TplTradeExitUiHint,
): Promise<void> {
  if (!db) return;
  try {
    const [row] = await db
      .select({ runSettingsJson: userStrategyRuns.runSettingsJson })
      .from(userStrategyRuns)
      .where(eq(userStrategyRuns.id, runId))
      .limit(1);
    const raw =
      row?.runSettingsJson && typeof row.runSettingsJson === "object" && !Array.isArray(row.runSettingsJson)
        ? { ...(row.runSettingsJson as Record<string, unknown>) }
        : {};
    raw[UI_HINT_KEY] = hint;
    await db
      .update(userStrategyRuns)
      .set({ runSettingsJson: raw, updatedAt: new Date() })
      .where(eq(userStrategyRuns.id, runId));
  } catch {
    /* ignore */
  }
}

export async function fetchStrategySlugForStrategyId(strategyId: string): Promise<string | null> {
  if (!db) return null;
  const [r] = await db
    .select({ slug: strategies.slug })
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);
  const s = r?.slug?.trim();
  return s && s.length > 0 ? s : null;
}

export async function maybeLogAndPersistTplExitFromFilledExitOrder(params: {
  strategyId: string;
  runId: string;
  userId: string;
  symbol: string;
  payload: TradingExecutionJobPayload;
}): Promise<void> {
  const slug = await fetchStrategySlugForStrategyId(params.strategyId);
  if (!slug || !isTrendProfitLockScalpingStrategySlug(slug)) return;
  if (params.payload.signalAction !== "exit") return;
  const reason = inferTplExitReasonFromExitJobPayload(params.payload);
  const leg =
    (params.payload.signalMetadata as Record<string, unknown> | undefined)?.leg != null
      ? String((params.payload.signalMetadata as Record<string, unknown>).leg)
      : null;
  logTplTradeExited({
    reason,
    runId: params.runId,
    userId: params.userId,
    strategyId: params.strategyId,
    symbol: params.symbol,
    leg,
  });
  await persistTplTradeExitUiHint(params.runId, {
    reason,
    at: new Date().toISOString(),
    leg: leg ?? undefined,
  });
}
