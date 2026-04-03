import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { botOrders, exchangeConnections } from "@/server/db/schema";

import { resolveExchangeTradingAdapter } from "./adapters/resolve-exchange-adapter";
import {
  finalizeBotOrderFromPlaceResult,
  insertBotOrderDraft,
  markBotOrderSubmitting,
  updateBotOrderFromSync,
} from "./bot-order-service";
import { assertRunStillEligibleForExecution } from "./eligibility";
import {
  claimNextTradingJob,
  completeTradingJob,
  failTradingJobRetryOrDead,
} from "./execution-queue";
import { bumpBotPositionNetQuantity } from "./position-service";
import { tradingLog } from "./trading-log";

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

  const elig = await assertRunStillEligibleForExecution(p.runId);
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

  if (p.correlationId) {
    const [existing] = await db
      .select({ id: botOrders.id })
      .from(botOrders)
      .where(
        and(
          eq(botOrders.correlationId, p.correlationId),
          eq(botOrders.subscriptionId, row.subscriptionId),
        ),
      )
      .limit(1);
    if (existing) {
      tradingLog("info", "job_idempotent_skip", {
        jobId: job.id,
        botOrderId: existing.id,
        correlationId: p.correlationId,
      });
      await completeTradingJob(job.id);
      return { processed: true };
    }
  }

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

  await markBotOrderSubmitting(draft.id);

  const place = await adapterRes.adapter.placeOrder({
    internalClientOrderId: draft.internalClientOrderId,
    symbol: p.symbol,
    side: p.side,
    orderType: p.orderType,
    quantity: p.quantity,
    limitPrice: p.limitPrice ?? null,
  });

  await finalizeBotOrderFromPlaceResult(draft.id, place);

  if (!place.ok) {
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      place.error,
    );
    return { processed: true };
  }

  const sync = await adapterRes.adapter.syncOrderStatus(place.externalOrderId);
  if (sync.ok) {
    const st = mapSyncStatus(sync.status);
    await updateBotOrderFromSync({
      botOrderId: draft.id,
      status: st,
      rawSyncResponse: sync.raw,
    });
    if (sync.status === "filled") {
      const signed =
        p.side === "buy" ? p.quantity : `-${p.quantity}`;
      await bumpBotPositionNetQuantity({
        userId: row.userId,
        subscriptionId: row.subscriptionId,
        strategyId: row.strategyId,
        symbol: p.symbol,
        deltaQty: signed,
      });
    }
  } else {
    tradingLog("warn", "bot_order_sync_failed", {
      botOrderId: draft.id,
      error: sync.error,
    });
  }

  await completeTradingJob(job.id);
  tradingLog("info", "job_completed", {
    jobId: job.id,
    botOrderId: draft.id,
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
