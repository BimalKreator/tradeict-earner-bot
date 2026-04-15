import { sql } from "drizzle-orm";

import { db } from "@/server/db";

import { tradingLog } from "./trading-log";

/**
 * Applies a fill to subscription-level position tracking per **exchange connection**
 * (multi-account: same symbol can have separate rows on Delta 1 vs Delta 2).
 */
export async function bumpBotPositionNetQuantity(params: {
  userId: string;
  subscriptionId: string;
  strategyId: string;
  exchangeConnectionId: string;
  symbol: string;
  /** Signed delta (buy +, sell -) in position units. */
  deltaQty: string;
}): Promise<void> {
  if (!db) return;

  await db.execute(sql`
    INSERT INTO bot_positions (
      id, user_id, subscription_id, strategy_id, exchange_connection_id, symbol, net_quantity, opened_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${params.userId}::uuid,
      ${params.subscriptionId}::uuid,
      ${params.strategyId}::uuid,
      ${params.exchangeConnectionId}::uuid,
      ${params.symbol},
      ${params.deltaQty}::numeric,
      NOW(),
      NOW()
    )
    ON CONFLICT (subscription_id, symbol, exchange_connection_id)
    DO UPDATE SET
      net_quantity = bot_positions.net_quantity::numeric + excluded.net_quantity::numeric,
      updated_at = NOW()
  `);

  tradingLog("info", "bot_position_bumped", {
    subscriptionId: params.subscriptionId,
    exchangeConnectionId: params.exchangeConnectionId,
    symbol: params.symbol,
    deltaQty: params.deltaQty,
  });
}
