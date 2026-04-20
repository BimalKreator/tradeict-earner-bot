import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";

import type { Database } from "@/server/db";
import {
  hedgeScalpingVirtualClips,
  hedgeScalpingVirtualRuns,
} from "@/server/db/schema/hedge-scalping";
import { virtualBotOrders, virtualStrategyRuns } from "@/server/db/schema/virtual-trading";
import { contractsFromUsdNotionalAndContractValue } from "@/server/exchange/delta-contract-sizing";

import { generateInternalClientOrderId } from "@/server/trading/ids";

export type HedgeScalpingDbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const HS_FEE_BPS = (() => {
  const v = Number(process.env.VIRTUAL_HS_FEE_BPS ?? "0");
  return Number.isFinite(v) && v >= 0 ? v : 0;
})();

function n(raw: string | number | null | undefined): number {
  const x = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(x) ? x : 0;
}

function fmtQty(q: number): string {
  return Number.isFinite(q) ? q.toFixed(8) : "0";
}

function fmtPx(p: number): string {
  return Number.isFinite(p) ? p.toFixed(8) : "0";
}

function fmtMoney(p: number): string {
  return Number.isFinite(p) ? p.toFixed(2) : "0";
}

/** Notional-based fee on entry + exit legs (bps of notional each). */
export function hedgeVirtualRoundtripFeeUsd(
  entryPx: number,
  exitPx: number,
  qty: number,
  bps: number = HS_FEE_BPS,
): number {
  if (!(bps > 0) || !(qty > 0)) return 0;
  const r = bps / 10_000;
  return (Math.abs(entryPx * qty) + Math.abs(exitPx * qty)) * r;
}

export function hedgeOpenSide(pos: "LONG" | "SHORT"): "buy" | "sell" {
  return pos === "LONG" ? "buy" : "sell";
}

export function hedgeCloseSide(pos: "LONG" | "SHORT"): "buy" | "sell" {
  return pos === "LONG" ? "sell" : "buy";
}

export function hedgeLegGrossPnlUsd(params: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  qty: number;
}): number {
  const { side, entryPrice, exitPrice, qty } = params;
  if (!(qty > 0)) return 0;
  if (side === "LONG") {
    return (exitPrice - entryPrice) * qty;
  }
  return (entryPrice - exitPrice) * qty;
}

export function hedgeSizingBalanceUsd(virtualRun: {
  virtualCapitalUsd: string;
  virtualAvailableCashUsd: string;
}): number {
  const cap = n(virtualRun.virtualCapitalUsd);
  if (cap > 0) return cap;
  return Math.max(0, n(virtualRun.virtualAvailableCashUsd));
}

export function computeHedgeScalpingD1Qty(params: {
  balanceUsd: number;
  contractValueUsd: number;
  baseQtyPct: number;
}): number {
  const { contractValueUsd, baseQtyPct } = params;
  const balanceUsd = Math.max(0, params.balanceUsd);
  if (!(contractValueUsd > 0) || !(balanceUsd > 0)) return 0;
  const pct = Math.min(100, Math.max(0, baseQtyPct));
  const positionUsd = Math.min(balanceUsd * (pct / 100), balanceUsd);
  const rawContracts = contractsFromUsdNotionalAndContractValue({
    notionalUsd: positionUsd,
    contractValueUsd,
  });
  return rawContracts >= 1 ? rawContracts : 0;
}

export function computeHedgeScalpingD2StepQty(d1Qty: number, stepQtyPct: number): number {
  if (!(d1Qty > 0)) return 0;
  const pct = Math.min(100, Math.max(0, stepQtyPct));
  if (!(pct > 0)) return 0;
  const raw = Math.floor(d1Qty * (pct / 100));
  return raw >= 1 ? raw : 1;
}

export function hsCorrelationD1Entry(hedgeRunId: string): string {
  return `hs_d1_${hedgeRunId}`;
}

export function hsCorrelationD2Entry(stepLevel: number, clipId: string): string {
  return `hs_d2_step${stepLevel}_${clipId}`;
}

export function hsCorrelationD1Exit(hedgeRunId: string): string {
  return `hs_d1_exit_${hedgeRunId}_${randomBytes(4).toString("hex")}`;
}

export function hsCorrelationD2Exit(clipId: string): string {
  return `hs_d2_exit_${clipId}_${randomBytes(4).toString("hex")}`;
}

export async function insertHsVirtualFilledOrder(
  tx: HedgeScalpingDbTx,
  params: {
    virtualPaperRunId: string;
    userId: string;
    strategyId: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    fillPrice: number;
    correlationId: string;
    signalAction: "entry" | "exit";
    realizedPnlUsd: number | null;
  },
): Promise<void> {
  const now = new Date();
  const qty = Math.abs(params.quantity);
  const px = params.fillPrice;
  const gross = params.realizedPnlUsd;
  let profitPercent: string | null = null;
  if (gross != null && qty > 0 && px > 0) {
    const denom = qty * px;
    if (denom > 0) {
      profitPercent = ((gross / denom) * 100).toFixed(6);
    }
  }

  await tx.insert(virtualBotOrders).values({
    internalClientOrderId: generateInternalClientOrderId(),
    correlationId: params.correlationId,
    virtualRunId: params.virtualPaperRunId,
    userId: params.userId,
    strategyId: params.strategyId,
    symbol: params.symbol,
    side: params.side,
    orderType: "market",
    quantity: fmtQty(qty),
    limitPrice: null,
    status: "filled",
    lastSyncedAt: now,
    tradeSource: "bot",
    venueOrderState: "simulated",
    fillPrice: fmtPx(px),
    filledQty: fmtQty(qty),
    realizedPnlUsd:
      gross != null && Number.isFinite(gross) && Math.abs(gross) > 1e-12
        ? fmtMoney(gross)
        : null,
    profitPercent,
    signalAction: params.signalAction,
    rawSubmitResponse: {
      hedge_scalping: true,
      correlation_id: params.correlationId,
    },
    updatedAt: now,
  });
}

export async function applyHsVirtualBalanceDelta(
  tx: HedgeScalpingDbTx,
  virtualPaperRunId: string,
  netUsd: number,
): Promise<void> {
  if (!Number.isFinite(netUsd) || netUsd === 0) return;
  const [row] = await tx
    .select({
      virtualAvailableCashUsd: virtualStrategyRuns.virtualAvailableCashUsd,
      virtualRealizedPnlUsd: virtualStrategyRuns.virtualRealizedPnlUsd,
    })
    .from(virtualStrategyRuns)
    .where(eq(virtualStrategyRuns.id, virtualPaperRunId))
    .limit(1);
  if (!row) return;
  const cash = n(row.virtualAvailableCashUsd) + netUsd;
  const realized = n(row.virtualRealizedPnlUsd) + netUsd;
  await tx
    .update(virtualStrategyRuns)
    .set({
      virtualAvailableCashUsd: fmtMoney(cash),
      virtualRealizedPnlUsd: fmtMoney(realized),
      updatedAt: new Date(),
    })
    .where(eq(virtualStrategyRuns.id, virtualPaperRunId));
}

export async function resolveVirtualPaperRunId(
  tx: HedgeScalpingDbTx,
  params: { userId: string; strategyId: string },
): Promise<string | null> {
  const [r] = await tx
    .select({ id: virtualStrategyRuns.id })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.userId, params.userId),
        eq(virtualStrategyRuns.strategyId, params.strategyId),
        eq(virtualStrategyRuns.status, "active"),
      ),
    )
    .limit(1);
  return r?.id ?? null;
}

export async function loadVirtualPaperRunForSizing(
  tx: HedgeScalpingDbTx,
  virtualPaperRunId: string,
): Promise<{
  virtualCapitalUsd: string;
  virtualAvailableCashUsd: string;
} | null> {
  const [r] = await tx
    .select({
      virtualCapitalUsd: virtualStrategyRuns.virtualCapitalUsd,
      virtualAvailableCashUsd: virtualStrategyRuns.virtualAvailableCashUsd,
    })
    .from(virtualStrategyRuns)
    .where(eq(virtualStrategyRuns.id, virtualPaperRunId))
    .limit(1);
  return r ?? null;
}

export async function fetchActiveClipForStep(
  tx: HedgeScalpingDbTx,
  params: { hedgeRunId: string; stepLevel: number },
): Promise<typeof hedgeScalpingVirtualClips.$inferSelect | null> {
  const [c] = await tx
    .select()
    .from(hedgeScalpingVirtualClips)
    .where(
      and(
        eq(hedgeScalpingVirtualClips.runId, params.hedgeRunId),
        eq(hedgeScalpingVirtualClips.stepLevel, params.stepLevel),
        eq(hedgeScalpingVirtualClips.status, "active"),
      ),
    )
    .limit(1);
  return c ?? null;
}

export async function fetchHedgeRunRow(
  tx: HedgeScalpingDbTx,
  hedgeRunId: string,
): Promise<typeof hedgeScalpingVirtualRuns.$inferSelect | null> {
  const [r] = await tx
    .select()
    .from(hedgeScalpingVirtualRuns)
    .where(eq(hedgeScalpingVirtualRuns.runId, hedgeRunId))
    .limit(1);
  return r ?? null;
}
