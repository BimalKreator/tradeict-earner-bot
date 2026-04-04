import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { botExecutionLogs, botOrders } from "@/server/db/schema";

import type { PlaceOrderResult } from "./adapters/exchange-adapter-types";
import { generateInternalClientOrderId } from "./ids";
import { tradingLog } from "./trading-log";

function isPostgresUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  return code === "23505";
}

async function findBotOrderByCorrelation(
  correlationId: string,
  subscriptionId: string,
): Promise<{ id: string; internalClientOrderId: string } | null> {
  if (!db) return null;
  const [row] = await db
    .select({
      id: botOrders.id,
      internalClientOrderId: botOrders.internalClientOrderId,
    })
    .from(botOrders)
    .where(
      and(
        eq(botOrders.correlationId, correlationId),
        eq(botOrders.subscriptionId, subscriptionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function recordBotExecutionLog(params: {
  botOrderId: string;
  level: "info" | "warn" | "error";
  message: string;
  rawPayload?: Record<string, unknown> | null;
}): Promise<void> {
  if (!db) return;
  await db.insert(botExecutionLogs).values({
    botOrderId: params.botOrderId,
    level: params.level,
    message: params.message.slice(0, 8000),
    rawPayload: params.rawPayload ?? null,
  });
}

export async function insertBotOrderDraft(params: {
  userId: string;
  subscriptionId: string;
  strategyId: string;
  runId: string;
  exchangeConnectionId: string;
  correlationId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: string;
  limitPrice?: string | null;
}): Promise<{ id: string; internalClientOrderId: string } | null> {
  if (!db) return null;
  const now = new Date();
  const internalClientOrderId = generateInternalClientOrderId();

  try {
    const [row] = await db
      .insert(botOrders)
      .values({
        internalClientOrderId,
        correlationId: params.correlationId,
        userId: params.userId,
        subscriptionId: params.subscriptionId,
        strategyId: params.strategyId,
        runId: params.runId,
        exchangeConnectionId: params.exchangeConnectionId,
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        quantity: params.quantity,
        limitPrice: params.limitPrice ?? null,
        status: "queued",
        updatedAt: now,
      })
      .returning({
        id: botOrders.id,
        internalClientOrderId: botOrders.internalClientOrderId,
      });

    if (!row) return null;
    tradingLog("info", "bot_order_drafted", {
      botOrderId: row.id,
      internalClientOrderId: row.internalClientOrderId,
      correlationId: params.correlationId,
    });
    return row;
  } catch (e) {
    if (
      isPostgresUniqueViolation(e) &&
      params.correlationId &&
      params.correlationId.length > 0
    ) {
      const existing = await findBotOrderByCorrelation(
        params.correlationId,
        params.subscriptionId,
      );
      if (existing) {
        tradingLog("info", "bot_order_draft_deduped_correlation", {
          botOrderId: existing.id,
          correlationId: params.correlationId,
        });
        return existing;
      }
    }
    throw e;
  }
}

export async function markBotOrderSubmitting(botOrderId: string): Promise<void> {
  if (!db) return;
  await db
    .update(botOrders)
    .set({ status: "submitting", updatedAt: new Date() })
    .where(eq(botOrders.id, botOrderId));
}

export async function finalizeBotOrderFromPlaceResult(
  botOrderId: string,
  result: PlaceOrderResult,
): Promise<void> {
  if (!db) return;
  const [existing] = await db
    .select({ externalOrderId: botOrders.externalOrderId })
    .from(botOrders)
    .where(eq(botOrders.id, botOrderId))
    .limit(1);
  if (result.ok && existing?.externalOrderId) {
    tradingLog("info", "bot_order_finalize_skip_has_external", {
      botOrderId,
      externalOrderId: existing.externalOrderId,
    });
    return;
  }
  const now = new Date();
  if (result.ok) {
    await db
      .update(botOrders)
      .set({
        status: "open",
        externalOrderId: result.externalOrderId,
        externalClientOrderId: result.externalClientOrderId ?? null,
        rawSubmitResponse: result.raw,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(botOrders.id, botOrderId));
    tradingLog("info", "bot_order_submitted", {
      botOrderId,
      externalOrderId: result.externalOrderId,
    });
    return;
  }

  await db
    .update(botOrders)
    .set({
      status: "failed",
      errorMessage: result.error.slice(0, 2000),
      rawSubmitResponse: result.raw ?? null,
      updatedAt: now,
    })
    .where(eq(botOrders.id, botOrderId));
  await recordBotExecutionLog({
    botOrderId,
    level: "error",
    message: result.error.slice(0, 2000),
    rawPayload: result.raw ?? { note: "no_raw_body" },
  });
  tradingLog("warn", "bot_order_submit_failed", {
    botOrderId,
    error: result.error,
  });
}

export async function updateBotOrderFromSync(params: {
  botOrderId: string;
  status: "open" | "filled" | "partial_fill" | "cancelled" | "rejected" | "failed";
  rawSyncResponse: Record<string, unknown>;
  venueOrderState?: string | null;
  fillPrice?: string | null;
  filledQty?: string | null;
}): Promise<void> {
  if (!db) return;
  const now = new Date();
  await db
    .update(botOrders)
    .set({
      status: params.status,
      rawSyncResponse: params.rawSyncResponse,
      lastSyncedAt: now,
      updatedAt: now,
      venueOrderState: params.venueOrderState ?? null,
      fillPrice: params.fillPrice ?? null,
      filledQty: params.filledQty ?? null,
    })
    .where(eq(botOrders.id, params.botOrderId));
}
