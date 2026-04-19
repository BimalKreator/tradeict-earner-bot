import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session";
import { isHedgeScalpingStrategySlug } from "@/lib/hedge-scalping-config";
import {
  classifyHedgeScalpingVirtualDualAccount,
  deriveLedgerMetrics,
  type LedgerOrderRow,
} from "@/lib/virtual-ledger-metrics";
import { adminActiveRecordExists } from "@/server/auth/verify-admin-record";
import { db } from "@/server/db";
import {
  botPositions,
  hedgeScalpingVirtualClips,
  hedgeScalpingVirtualRuns,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  virtualBotOrders,
  virtualStrategyRuns,
  type TradingExecutionJobPayload,
} from "@/server/db/schema";
import { fetchDeltaIndiaTickerMarkPrice } from "@/server/exchange/delta-india-positions";
import { dispatchStrategyExecutionSignal } from "@/server/trading/strategy-signal-dispatcher";
import { assertVirtualRunStillEligibleForExecution } from "@/server/trading/virtual-eligibility";
import { simulateVirtualOrder } from "@/server/trading/virtual-order-simulator";

export const dynamic = "force-dynamic";

type CloseMode = "virtual" | "real";

function oppositeSideForNet(netQty: number): "buy" | "sell" {
  return netQty > 0 ? "sell" : "buy";
}

/** Hedge D1 entry correlation only: `hs_d1_<runId>` (not `hs_d1_exit_...`). */
function parseHsD1HedgeRunIdFromCorrelation(correlationId: string | null | undefined): string | null {
  const m = /^hs_d1_([0-9a-f-]{36})$/i.exec(correlationId ?? "");
  return m?.[1] ?? null;
}

function parseHedgeRunIdFromVirtualLedger(ledger: LedgerOrderRow[]): string | null {
  for (const o of ledger) {
    const id = parseHsD1HedgeRunIdFromCorrelation(o.correlationId);
    if (id) return id;
  }
  return null;
}

async function finalizeHedgeScalpingVirtualRunOnManualClose(params: {
  hedgeRunId: string;
  userId: string;
  strategyId: string;
}): Promise<void> {
  if (!db) return;
  const now = new Date();
  await db
    .update(hedgeScalpingVirtualRuns)
    .set({ status: "completed", closedAt: now })
    .where(
      and(
        eq(hedgeScalpingVirtualRuns.runId, params.hedgeRunId),
        eq(hedgeScalpingVirtualRuns.userId, params.userId),
        eq(hedgeScalpingVirtualRuns.strategyId, params.strategyId),
        eq(hedgeScalpingVirtualRuns.status, "active"),
      ),
    );
  await db
    .update(hedgeScalpingVirtualClips)
    .set({ status: "completed", closedAt: now })
    .where(
      and(
        eq(hedgeScalpingVirtualClips.runId, params.hedgeRunId),
        eq(hedgeScalpingVirtualClips.status, "active"),
      ),
    );
}

async function closeVirtualRun(runId: string, requesterUserId: string, isAdmin: boolean) {
  if (!db) return { ok: false as const, error: "no_database" };
  const [run] = await db
    .select({
      id: virtualStrategyRuns.id,
      userId: virtualStrategyRuns.userId,
      strategyId: virtualStrategyRuns.strategyId,
      strategySlug: strategies.slug,
      openNetQty: virtualStrategyRuns.openNetQty,
      openSymbol: virtualStrategyRuns.openSymbol,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(eq(virtualStrategyRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false as const, error: "virtual_run_not_found" };
  if (!isAdmin && run.userId !== requesterUserId) {
    return { ok: false as const, error: "forbidden" };
  }

  const orderRows = await db
    .select({
      symbol: virtualBotOrders.symbol,
      side: virtualBotOrders.side,
      quantity: virtualBotOrders.quantity,
      fillPrice: virtualBotOrders.fillPrice,
      status: virtualBotOrders.status,
      correlationId: virtualBotOrders.correlationId,
      createdAt: virtualBotOrders.createdAt,
    })
    .from(virtualBotOrders)
    .where(eq(virtualBotOrders.virtualRunId, run.id))
    .orderBy(virtualBotOrders.createdAt);

  const ledger: LedgerOrderRow[] = orderRows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    quantity: String(row.quantity),
    fillPrice: row.fillPrice != null ? String(row.fillPrice) : null,
    status: row.status,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  }));
  const slug = run.strategySlug ?? "";
  const d1State = isHedgeScalpingStrategySlug(slug)
    ? deriveLedgerMetrics(
        ledger.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "primary"),
        null,
      )
    : deriveLedgerMetrics(ledger, null);
  const d2State = isHedgeScalpingStrategySlug(slug)
    ? deriveLedgerMetrics(
        ledger.filter((o) => classifyHedgeScalpingVirtualDualAccount(o) === "secondary"),
        null,
      )
    : deriveLedgerMetrics([], null);
  const legClosures = [
    {
      account: "D1" as const,
      netQty: d1State.openNetQty,
      symbol: d1State.openSymbol ?? run.openSymbol?.trim() ?? "",
    },
    {
      account: "D2" as const,
      netQty: d2State.openNetQty,
      symbol: d2State.openSymbol ?? "",
    },
  ].filter((leg) => Math.abs(leg.netQty) > 1e-8 && leg.symbol);

  if (legClosures.length === 0) {
    if (isHedgeScalpingStrategySlug(slug)) {
      const openNet = Number(String(run.openNetQty ?? "0").trim());
      const hedgeRunId = parseHedgeRunIdFromVirtualLedger(ledger);
      if (hedgeRunId && Math.abs(openNet) < 1e-8) {
        await finalizeHedgeScalpingVirtualRunOnManualClose({
          hedgeRunId,
          userId: run.userId,
          strategyId: run.strategyId,
        });
      }
    }
    return { ok: true as const, closed: 0, detail: "already_flat" };
  }

  const elig = await assertVirtualRunStillEligibleForExecution(run.id, { signalAction: "exit" });
  if (!elig.ok) return { ok: false as const, error: `virtual_ineligible:${elig.reason}` };

  let closed = 0;
  for (const leg of legClosures) {
    const markPrice =
      (await fetchDeltaIndiaTickerMarkPrice({ symbol: leg.symbol })) ?? undefined;
    const payload: TradingExecutionJobPayload = {
      kind: "execute_strategy_signal",
      executionMode: "virtual",
      strategyId: run.strategyId,
      correlationId: `manual_close_virtual_${run.id}_${leg.account}_${Date.now()}`,
      symbol: leg.symbol,
      side: oppositeSideForNet(leg.netQty),
      orderType: "market",
      quantity: Math.abs(leg.netQty).toFixed(8),
      targetUserId: run.userId,
      virtualRunId: run.id,
      signalAction: "exit",
      signalMetadata: {
        source: "manual_close",
        close_all_legs: true,
        account: leg.account,
        ...(markPrice != null && markPrice > 0 ? { mark_price: markPrice } : {}),
      },
    };
    const sim = await simulateVirtualOrder({ payload, row: elig.row });
    if (!sim.ok) return { ok: false as const, error: sim.error };
    closed += 1;
  }
  if (isHedgeScalpingStrategySlug(slug)) {
    const hedgeRunId = parseHedgeRunIdFromVirtualLedger(ledger);
    if (hedgeRunId) {
      await finalizeHedgeScalpingVirtualRunOnManualClose({
        hedgeRunId,
        userId: run.userId,
        strategyId: run.strategyId,
      });
    }
  }
  return { ok: true as const, closed, detail: "virtual_closed" };
}

async function closeRealRun(runId: string, requesterUserId: string, isAdmin: boolean) {
  if (!db) return { ok: false as const, error: "no_database" };
  const [run] = await db
    .select({
      runId: userStrategyRuns.id,
      userId: userStrategySubscriptions.userId,
      strategyId: userStrategySubscriptions.strategyId,
      primaryEx: userStrategyRuns.primaryExchangeConnectionId,
      secondaryEx: userStrategyRuns.secondaryExchangeConnectionId,
      subscriptionId: userStrategyRuns.subscriptionId,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(eq(userStrategyRuns.id, runId))
    .limit(1);
  if (!run) return { ok: false as const, error: "run_not_found" };
  if (!isAdmin && run.userId !== requesterUserId) {
    return { ok: false as const, error: "forbidden" };
  }

  const positions = await db
    .select({
      symbol: botPositions.symbol,
      netQty: botPositions.netQuantity,
      exchangeConnectionId: botPositions.exchangeConnectionId,
    })
    .from(botPositions)
    .where(
      and(
        eq(botPositions.subscriptionId, run.subscriptionId),
        sql`abs(cast(${botPositions.netQuantity} as numeric)) > 0.00000001`,
      ),
    );

  if (positions.length === 0) {
    return { ok: true as const, closed: 0, detail: "already_flat" };
  }

  let closed = 0;
  for (const p of positions) {
    const net = Number(p.netQty ?? "0");
    if (!(Math.abs(net) > 1e-8)) continue;
    const venue =
      p.exchangeConnectionId === run.secondaryEx
        ? "secondary"
        : p.exchangeConnectionId === run.primaryEx
          ? "primary"
          : "auto";
    const res = await dispatchStrategyExecutionSignal({
      strategyId: run.strategyId,
      correlationId: `manual_close_real_${runId}_${p.exchangeConnectionId}_${Date.now()}`,
      symbol: p.symbol,
      side: oppositeSideForNet(net),
      orderType: "market",
      quantity: Math.abs(net).toFixed(8),
      actionType: "exit",
      exchangeVenue: venue,
      targetUserIds: [run.userId],
      targetRunIds: [run.runId],
      metadata: {
        source: "manual_close",
        close_all_legs: true,
      },
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    closed += res.jobsEnqueued;
  }
  return { ok: true as const, closed, detail: "real_exit_jobs_dispatched" };
}

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const isAdmin = session.role === "admin";
  if (isAdmin) {
    const exists = await adminActiveRecordExists(session.userId);
    if (!exists) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    runId?: string;
    mode?: CloseMode;
  } | null;
  const runId = body?.runId?.trim() ?? "";
  const mode = body?.mode;
  if (!runId || (mode !== "virtual" && mode !== "real")) {
    return Response.json({ error: "runId and mode are required." }, { status: 400 });
  }

  const out =
    mode === "virtual"
      ? await closeVirtualRun(runId, session.userId, isAdmin)
      : await closeRealRun(runId, session.userId, isAdmin);
  if (!out.ok) return Response.json({ error: out.error }, { status: 400 });
  return Response.json(out);
}

