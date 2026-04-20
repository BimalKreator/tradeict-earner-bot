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

function signedQtyFromFill(params: {
  side: "buy" | "sell";
  fallbackQty: string;
  filledQty?: string | null;
}): string {
  const rawFilled = params.filledQty != null ? String(params.filledQty).trim() : "";
  const filled = Number(rawFilled);
  const useQty =
    rawFilled.length > 0 && Number.isFinite(filled) && filled > 0
      ? rawFilled
      : params.fallbackQty;
  return params.side === "buy" ? useQty : `-${useQty}`;
}

function isNonRetryableDeltaExecutionError(errorText: string): boolean {
  const s = errorText.toLowerCase();
  return (
    s.includes("family_position_limit_exceeded") ||
    s.includes("\"code\":\"unsupported\"") ||
    s.includes("leverage unsupported for requested")
  );
}

async function runPostSubmitSync(
  adapter: ExchangeTradingAdapter,
  botOrderId: string,
  externalOrderId: string,
  p: TradingExecutionJobPayload,
  eligRow: EligibleStrategyRunRow,
): Promise<void> {
  const manualEmergencyClose =
    p.signalAction === "exit" &&
    p.signalMetadata != null &&
    typeof p.signalMetadata === "object" &&
    (p.signalMetadata as Record<string, unknown>).manual_emergency_close === true;
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
      const signed = signedQtyFromFill({
        side: p.side,
        fallbackQty: p.quantity,
        filledQty: sync.filledQty ?? null,
      });
      await bumpBotPositionNetQuantity({
        userId: eligRow.userId,
        subscriptionId: eligRow.subscriptionId,
        strategyId: eligRow.strategyId,
        exchangeConnectionId: eligRow.exchangeConnectionId,
        symbol: p.symbol,
        deltaQty: signed,
      });
    } else if (
      manualEmergencyClose &&
      (sync.status === "open" || sync.status === "unknown")
    ) {
      // Emergency close UX fallback: market exits can be filled after immediate sync.
      // Flatten local position optimistically so strategy is not blocked by stale open qty.
      const signed = signedQtyFromFill({
        side: p.side,
        fallbackQty: p.quantity,
        filledQty: null,
      });
      await bumpBotPositionNetQuantity({
        userId: eligRow.userId,
        subscriptionId: eligRow.subscriptionId,
        strategyId: eligRow.strategyId,
        exchangeConnectionId: eligRow.exchangeConnectionId,
        symbol: p.symbol,
        deltaQty: signed,
      });
      tradingLog("warn", "manual_close_optimistic_position_flatten_applied", {
        botOrderId,
        externalOrderId,
        statusAtSync: sync.status,
        runId: eligRow.runId,
        exchangeConnectionId: eligRow.exchangeConnectionId,
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
 *    on the eligibility row when the strategy defines a max. Live Delta orders apply that leverage via
 *    `POST /v2/products/{id}/orders/leverage` before submit; **contract `size`** is an integer lot count at the venue.
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
  const emergencyExitBypass =
    signalAction === "exit" &&
    p.signalMetadata != null &&
    typeof p.signalMetadata === "object" &&
    (p.signalMetadata as Record<string, unknown>).manual_emergency_close === true;
  const manualCloseRequestId =
    p.signalMetadata != null &&
    typeof p.signalMetadata === "object" &&
    typeof (p.signalMetadata as Record<string, unknown>).manual_close_request_id ===
      "string"
      ? String(
          (p.signalMetadata as Record<string, unknown>).manual_close_request_id,
        )
      : null;
  const manualCloseErr = (tag: string, message: string): string =>
    manualCloseRequestId
      ? `${tag}: ${message}`
      : message;
  let effectiveQuantity = p.quantity;
  if (emergencyExitBypass) {
    const rawQty = Number(String(p.quantity ?? "").trim());
    if (Number.isFinite(rawQty) && Math.abs(rawQty) > 0 && Math.abs(rawQty) < 1) {
      effectiveQuantity = "1";
      tradingLog("warn", "manual_close_worker_quantity_adjusted", {
        manualCloseRequestId,
        jobId: job.id,
        originalQuantity: p.quantity,
        adjustedQuantity: effectiveQuantity,
        reason: "fractional_contract_qty_for_delta",
      });
    }
  }
  const payloadForExecution =
    effectiveQuantity === p.quantity ? p : { ...p, quantity: effectiveQuantity };

  if (manualCloseRequestId) {
    tradingLog("info", "manual_close_worker_job_claimed", {
      manualCloseRequestId,
      jobId: job.id,
      executionMode: p.executionMode ?? "live",
      signalAction,
      correlationId: p.correlationId,
      runId: p.runId ?? null,
      virtualRunId: p.virtualRunId ?? null,
      exchangeConnectionId: p.exchangeConnectionId ?? null,
    });
  }

  const isVirtual =
    p.executionMode === "virtual" &&
    typeof p.virtualRunId === "string" &&
    p.virtualRunId.length > 0;

  if (isVirtual) {
    const virtualRunId = p.virtualRunId as string;
    const vElig = await assertVirtualRunStillEligibleForExecution(virtualRunId, {
      signalAction,
      allowEmergencyExit: emergencyExitBypass,
    });
    if (!vElig.ok) {
      if (manualCloseRequestId) {
        tradingLog("warn", "manual_close_worker_virtual_ineligible", {
          manualCloseRequestId,
          jobId: job.id,
          reason: vElig.reason,
          virtualRunId,
        });
      }
      tradingLog("warn", "virtual_job_skipped_ineligible", {
        jobId: job.id,
        reason: vElig.reason,
        virtualRunId,
      });
      await failTradingJobRetryOrDead(
        job.id,
        job.attempts,
        job.maxAttempts,
        manualCloseErr(
          "manual_close_worker_virtual_ineligible",
          `virtual_ineligible:${vElig.reason}`,
        ),
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
      if (manualCloseRequestId) {
        tradingLog("error", "manual_close_worker_virtual_failed", {
          manualCloseRequestId,
          jobId: job.id,
          error: sim.error,
        });
      }
      await failTradingJobRetryOrDead(
        job.id,
        job.attempts,
        job.maxAttempts,
        manualCloseErr("manual_close_worker_virtual_failed", sim.error),
      );
      return { processed: true };
    }

    await completeTradingJob(job.id);
    tradingLog("info", "virtual_job_completed", {
      jobId: job.id,
      virtualRunId,
      correlationId: p.correlationId,
    });
    if (manualCloseRequestId) {
      tradingLog("info", "manual_close_worker_virtual_completed", {
        manualCloseRequestId,
        jobId: job.id,
        virtualRunId,
        correlationId: p.correlationId,
      });
    }
    return { processed: true };
  }

  if (!p.subscriptionId || !p.runId) {
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      manualCloseErr(
        "manual_close_worker_live_payload_invalid",
        "live_payload_missing_subscription_or_run",
      ),
    );
    return { processed: true };
  }

  const elig = await assertRunStillEligibleForExecution(p.runId, {
    signalAction,
    exchangeConnectionId: p.exchangeConnectionId,
    allowEmergencyExit: emergencyExitBypass,
  });
  if (!elig.ok) {
    if (manualCloseRequestId) {
      tradingLog("warn", "manual_close_worker_live_ineligible", {
        manualCloseRequestId,
        jobId: job.id,
        reason: elig.reason,
        runId: p.runId,
        exchangeConnectionId: p.exchangeConnectionId ?? null,
      });
    }
    tradingLog("warn", "job_skipped_ineligible", {
      jobId: job.id,
      reason: elig.reason,
      runId: p.runId,
    });
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      manualCloseErr("manual_close_worker_live_ineligible", `ineligible:${elig.reason}`),
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
      manualCloseErr("manual_close_worker_exchange_missing", "exchange_connection_missing"),
    );
    return { processed: true };
  }

  const adapterRes = await resolveExchangeTradingAdapter({
    provider: ec.provider,
    apiKeyCiphertext: ec.apiKeyCiphertext,
    apiSecretCiphertext: ec.apiSecretCiphertext,
  });

  if (!adapterRes.ok) {
    if (manualCloseRequestId) {
      tradingLog("error", "manual_close_worker_adapter_resolve_failed", {
        manualCloseRequestId,
        jobId: job.id,
        error: adapterRes.error,
      });
    }
    await failTradingJobRetryOrDead(
      job.id,
      job.attempts,
      job.maxAttempts,
      manualCloseErr("manual_close_worker_adapter_resolve_failed", adapterRes.error),
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
      quantity: payloadForExecution.quantity,
      limitPrice: p.limitPrice ?? null,
    });

    if (!draft) {
      await failTradingJobRetryOrDead(
        job.id,
        job.attempts,
        job.maxAttempts,
        manualCloseErr("manual_close_worker_bot_order_insert_failed", "bot_order_insert_failed"),
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
        symbol: payloadForExecution.symbol,
        side: payloadForExecution.side,
        orderType: payloadForExecution.orderType,
        quantity: payloadForExecution.quantity,
        limitPrice: payloadForExecution.limitPrice ?? null,
        reduceOnly: signalAction === "exit",
        leverage: payloadForExecution.leverage ?? row.leverage,
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
    if (manualCloseRequestId) {
      tradingLog("error", "manual_close_worker_place_failed", {
        manualCloseRequestId,
        jobId: job.id,
        botOrderId,
        error: place.error,
      });
    }
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
    const nonRetryable = isNonRetryableDeltaExecutionError(place.error);
    if (nonRetryable) {
      await recordBotExecutionLog({
        botOrderId,
        level: "error",
        message: `non_retryable_exchange_rejection: ${place.error}`,
        rawPayload: place.raw ?? null,
      });
      tradingLog("warn", "job_failed_non_retryable_exchange_rejection", {
        jobId: job.id,
        botOrderId,
        runId: row.runId,
        error: place.error,
      });
    }
    await failTradingJobRetryOrDead(
      job.id,
      nonRetryable ? job.maxAttempts : job.attempts,
      job.maxAttempts,
      manualCloseErr("manual_close_worker_place_failed", place.error),
    );
    return { processed: true };
  }

  await runPostSubmitSync(
    adapterRes.adapter,
    botOrderId,
    place.externalOrderId,
    payloadForExecution,
    row,
  );

  await completeTradingJob(job.id);
  tradingLog("info", "job_completed", {
    jobId: job.id,
    botOrderId,
    correlationId: p.correlationId,
  });
  if (manualCloseRequestId) {
    tradingLog("info", "manual_close_worker_live_completed", {
      manualCloseRequestId,
      jobId: job.id,
      botOrderId,
      correlationId: p.correlationId,
      externalOrderId: place.externalOrderId,
      signalAction,
    });
  }
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
