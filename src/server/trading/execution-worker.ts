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
import {
  claimNextTradingJob,
  completeTradingJob,
  failTradingJobRetryOrDead,
} from "./execution-queue";
import { bumpBotPositionNetQuantity } from "./position-service";
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
  const elig = await assertRunStillEligibleForExecution(p.runId, {
    signalAction,
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
