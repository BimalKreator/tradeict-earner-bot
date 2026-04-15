import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { botOrders, exchangeConnections } from "@/server/db/schema";

import type {
  ExchangeTradingAdapter,
  PlaceOrderResult,
} from "./adapters/exchange-adapter-types";
import { resolveExchangeTradingAdapter } from "./adapters/resolve-exchange-adapter";
import {
  finalizeBotOrderFromPlaceResult,
  insertBotOrderDraft,
  markBotOrderSubmitting,
  recordBotExecutionLog,
  updateBotOrderFromSync,
} from "./bot-order-service";
import {
  assertRunStillEligibleForExecution,
  type EligibleStrategyRunRow,
} from "./eligibility";
import { assertVirtualRunStillEligibleForExecution } from "./virtual-eligibility";
import { simulateVirtualOrder } from "./virtual-order-simulator";
import {
  claimNextTradingJob,
  completeTradingJob,
  failTradingJobRetryOrDead,
} from "./execution-queue";
import { isInsufficientBalanceOrMarginDeltaError } from "./delta-order-errors";
import { bumpBotPositionNetQuantity } from "./position-service";
import { pauseRunForInsufficientFunds } from "./run-risk-pause";
import { tradingLog } from "./trading-log";

import type { TradingExecutionJobPayload } from "@/server/db/schema";

function mapSyncStatus(
  s: "open" | "filled" | "partial" | "cancelled" | "rejected" | "unknown",
):
  | "open"
  | "filled"
  | "partial_fill"
  | "cancelled"
  | "rejected"
  | "failed" {
  if (s === "partial") return "partial_fill";
  if (s === "unknown") return "open";
  return s;
}

async function runPostSubmitSync(
  adapter: ExchangeTradingAdapter,
  botOrderId: string,
  externalOrderId: string,
  p: TradingExecutionJobPayload,
  eligRow: EligibleStrategyRunRow,
): Promise<void> {
  const sync = await adapter.syncOrderStatus(externalOrderId);
  if (sync.ok) {
    const st = mapSyncStatus(sync.status);
    await updateBotOrderFromSync({
      botOrderId,
      status: st,
      rawSyncResponse: sync.raw,
      venueOrderState: sync.venueOrderState ?? null,
      fillPrice: sync.fillPrice ?? null,
      filledQty: sync.filledQty ?? null,
    });
    if (sync.status === "filled") {
      const signed =
        p.side === "buy" ? p.quantity : `-${p.quantity}`;
      await bumpBotPositionNetQuantity({
        userId: eligRow.userId,
        subscriptionId: eligRow.subscriptionId,
        strategyId: eligRow.strategyId,
        exchangeConnectionId: eligRow.exchangeConnectionId,
        symbol: p.symbol,
        deltaQty: signed,
      });
    }
  } else {
    tradingLog("warn", "bot_order_sync_failed", {
      botOrderId,
      error: sync.error,
    });
    await recordBotExecutionLog({
      botOrderId,
      level: "warn",
      message: `sync_failed: ${sync.error}`,
    });
  }
}

/**
 * Processes a single claimed job: eligibility → adapter → `bot_orders` → optional sync → position bump on fill.
 *
 * ## Gate hierarchy (safety order)
 *
 * 1. **Idempotency / correlation** — When `correlationId` matches an existing `bot_orders` row with a Delta
 *    `external_order_id`, we reconcile/sync only (no duplicate venue submission). Failed/rejected rows short-circuit.
 * 2. **Global emergency stop** — `app_settings.global_emergency_stop.active` halts **all** new submissions,
 *    including exits (`assertRunStillEligibleForExecution` returns `global_emergency_stop`).
 * 3. **Revenue / billing block** — `blocked_revenue_due`: new **entries** blocked; **exits** still allowed to reduce risk.
 * 4. **Admin / user pause** — e.g. `paused_admin`, `paused_revenue_due`, non-active run states block execution
 *    (exits are not exempt except where explicitly allowed for revenue block above).
 * 5. **Strategy catalog** — `strategies.status` must be `active` (admin strategy pause stops new fan-out from dispatcher).
 * 6. **Exchange readiness** — Delta connection active, keys present, last test success.
 * 7. **Capital / leverage settings** — Required numerics present; **leverage** is capped to `strategies.max_leverage`
 *    on the eligibility row when the strategy defines a max.
 * 8. **Margin / API errors** — After a failed `placeOrder`, Delta “insufficient balance/margin” style errors
 *    auto-pause the run as `paused_insufficient_funds` to avoid API spam (order row remains failed as recorded).
 */
export async function processOneTradingJob(
  workerId: string,
): Promise<{ processed: boolean }> {
  if (!db) return { processed: false };

  const job = await claimNextTradingJob(workerId);
  if (!job) return { processed: false };

  const p = job.payload;
  if (p.kind !== "execute_strategy_signal") {
    await completeTradingJob(job.id);
    return { processed: true };
  }

  const signalAction = p.signalAction ?? "entry";

  const isVirtual =
    p.executionMode === "virtual" &&
    typeof p.virtualRunId === "string" &&
    p.virtualRunId.length > 0;

  if (isVirtual) {
    const virtualRunId = p.virtualRunId as string;
    const vElig = await assertVirtualRunStillEligibleForExecution(virtualRunId, {
      signalAction,
    });
    if (!vElig.ok) {
      tradingLog("warn", "virtual_job_skipped_ineligible", {
        jobId: job.id,
        reason: vElig.reason,
        virtualRunId,
      });
      await failTradingJobRetryOrDead(
        job.id,
        job.attempts,
        job.maxAttempts,
        `virtual_ineligible:${vElig.reason}`,
      );
      return { processed: true };
    }

    if (vElig.row.leverageCapped) {
      tradingLog("info", "virtual_leverage_capped_to_strategy_max", {
        virtualRunId: vElig.row.virtualRunId,
        strategyId: vElig.row.strategyId,
      });
    }

    const sim = await simulateVirtualOrder({
      payload: p,
      row: vElig.row,
    });
    if (!sim.ok) {
      await failTradingJobRetryOrDead(
        job.id,
        job.attempts,
        job.maxAttempts,
        sim.error,
      );
      return { processed: true };
    }

    await completeTradingJob(job.id);
    tradingLog("info", "virtual_job_completed", {
      jobId: job.id,
      virtualRunId,
      correlationId: p.correlationId,
    });
    return { processed: true };
  }

  if (!p.subscriptionId || !p.runId) {
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      "live_payload_missing_subscription_or_run",
    );
    return { processed: true };
  }

  const elig = await assertRunStillEligibleForExecution(p.runId, {
    signalAction,
    exchangeConnectionId: p.exchangeConnectionId,
  });
  if (!elig.ok) {
    tradingLog("warn", "job_skipped_ineligible", {
      jobId: job.id,
      reason: elig.reason,
      runId: p.runId,
    });
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      `ineligible:${elig.reason}`,
    );
    return { processed: true };
  }

  const row = elig.row;
  if (row.leverageCapped) {
    tradingLog("info", "leverage_capped_to_strategy_max", {
      runId: row.runId,
      strategyId: row.strategyId,
    });
  }

  const [ec] = await db
    .select({
      apiKeyCiphertext: exchangeConnections.apiKeyCiphertext,
      apiSecretCiphertext: exchangeConnections.apiSecretCiphertext,
      provider: exchangeConnections.provider,
    })
    .from(exchangeConnections)
    .where(eq(exchangeConnections.id, row.exchangeConnectionId))
    .limit(1);

  if (!ec) {
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      "exchange_connection_missing",
    );
    return { processed: true };
  }

  const adapterRes = await resolveExchangeTradingAdapter({
    provider: ec.provider,
    apiKeyCiphertext: ec.apiKeyCiphertext,
    apiSecretCiphertext: ec.apiSecretCiphertext,
  });

  if (!adapterRes.ok) {
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      adapterRes.error,
    );
    return { processed: true };
  }

  let botOrderId: string | undefined;
  let internalClientOrderId: string | undefined;

  if (p.correlationId) {
    const [ex] = await db
      .select({
        id: botOrders.id,
        internalClientOrderId: botOrders.internalClientOrderId,
        externalOrderId: botOrders.externalOrderId,
        externalClientOrderId: botOrders.externalClientOrderId,
        status: botOrders.status,
        rawSubmitResponse: botOrders.rawSubmitResponse,
      })
      .from(botOrders)
      .where(
        and(
          eq(botOrders.correlationId, p.correlationId),
          eq(botOrders.subscriptionId, row.subscriptionId),
          eq(botOrders.exchangeConnectionId, row.exchangeConnectionId),
        ),
      )
      .limit(1);

    if (ex?.externalOrderId) {
      await runPostSubmitSync(
        adapterRes.adapter,
        ex.id,
        ex.externalOrderId,
        p,
        row,
      );
      await completeTradingJob(job.id);
      tradingLog("info", "job_completed_reconcile_external", {
        jobId: job.id,
        botOrderId: ex.id,
        correlationId: p.correlationId,
      });
      return { processed: true };
    }

    if (ex && (ex.status === "failed" || ex.status === "rejected")) {
      await completeTradingJob(job.id);
      return { processed: true };
    }

    if (ex) {
      botOrderId = ex.id;
      internalClientOrderId = ex.internalClientOrderId;
    }
  }

  if (!botOrderId || !internalClientOrderId) {
    const draft = await insertBotOrderDraft({
      userId: row.userId,
      subscriptionId: row.subscriptionId,
      strategyId: row.strategyId,
      runId: row.runId,
      exchangeConnectionId: row.exchangeConnectionId,
      correlationId: p.correlationId,
      symbol: p.symbol,
      side: p.side,
      orderType: p.orderType,
      quantity: p.quantity,
      limitPrice: p.limitPrice ?? null,
    });

    if (!draft) {
      await failTradingJobRetryOrDead(
        job.id,
        job.attempts,
        job.maxAttempts,
        "bot_order_insert_failed",
      );
      return { processed: true };
    }
    botOrderId = draft.id;
    internalClientOrderId = draft.internalClientOrderId;
  }

  await markBotOrderSubmitting(botOrderId);

  const [fresh] = await db
    .select({
      externalOrderId: botOrders.externalOrderId,
      externalClientOrderId: botOrders.externalClientOrderId,
      rawSubmitResponse: botOrders.rawSubmitResponse,
    })
    .from(botOrders)
    .where(eq(botOrders.id, botOrderId))
    .limit(1);

  let place: PlaceOrderResult;

  if (fresh?.externalOrderId) {
    place = {
      ok: true,
      externalOrderId: fresh.externalOrderId,
      externalClientOrderId: fresh.externalClientOrderId ?? null,
      raw:
        (fresh.rawSubmitResponse as Record<string, unknown> | null) ?? {},
    };
  } else {
    try {
      place = await adapterRes.adapter.placeOrder({
        internalClientOrderId,
        symbol: p.symbol,
        side: p.side,
        orderType: p.orderType,
        quantity: p.quantity,
        limitPrice: p.limitPrice ?? null,
        reduceOnly: signalAction === "exit",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordBotExecutionLog({
        botOrderId,
        level: "error",
        message: `placeOrder_exception: ${msg}`,
        rawPayload:
          e instanceof Error
            ? { name: e.name, stack: e.stack }
            : { thrown: String(e) },
      });
      place = { ok: false, error: msg };
    }
    await finalizeBotOrderFromPlaceResult(botOrderId, place);
  }

  if (!place.ok) {
    if (
      isInsufficientBalanceOrMarginDeltaError(
        place.error,
        place.raw ?? null,
      )
    ) {
      await pauseRunForInsufficientFunds(row.runId, place.error);
      tradingLog("warn", "run_paused_insufficient_funds", {
        runId: row.runId,
        botOrderId,
        jobId: job.id,
      });
    }
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      place.error,
    );
    return { processed: true };
  }

  await runPostSubmitSync(
    adapterRes.adapter,
    botOrderId,
    place.externalOrderId,
    p,
    row,
  );

  await completeTradingJob(job.id);
  tradingLog("info", "job_completed", {
    jobId: job.id,
    botOrderId,
    correlationId: p.correlationId,
  });
  return { processed: true };
}

export async function runTradingWorkerBatch(
  workerId: string,
  maxJobs: number,
): Promise<{ completed: number }> {
  let n = 0;
  for (let i = 0; i < maxJobs; i++) {
    const r = await processOneTradingJob(workerId);
    if (!r.processed) break;
    n += 1;
  }
  return { completed: n };
}
