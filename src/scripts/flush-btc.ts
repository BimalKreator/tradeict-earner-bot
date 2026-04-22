/**
 * Standalone cleanup: ghost BTCUSD bot state + TPL runtime JSON.
 * Does not use Next.js or Drizzle's shared `db` (null when DATABASE_URL missing at import time).
 *
 * Run: npx tsx src/scripts/flush-btc.ts
 */
import "dotenv/config";

import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env or export it before running.");
    process.exit(1);
  }

  const dbClient = postgres(url, { max: 1 });

  console.log("Starting BTCUSD flush and TPL memory reset (direct postgres connection)...");

  try {
    await dbClient`
      DELETE FROM bot_execution_logs
      WHERE bot_order_id IN (
        SELECT id FROM bot_orders WHERE upper(trim(symbol)) = 'BTCUSD'
      )
    `;

    await dbClient`
      DELETE FROM bot_orders WHERE upper(trim(symbol)) = 'BTCUSD'
    `;

    await dbClient`
      DELETE FROM bot_positions WHERE upper(trim(symbol)) = 'BTCUSD'
    `;

    await dbClient`
      DELETE FROM trading_execution_jobs
      WHERE job_kind = 'execute_strategy_signal'
        AND upper(trim(coalesce(payload->>'symbol', ''))) = 'BTCUSD'
    `;

    await dbClient`
      UPDATE user_strategy_runs
      SET
        run_settings_json = run_settings_json - 'trendProfitLockRuntime',
        updated_at = now()
      WHERE run_settings_json ? 'trendProfitLockRuntime'
    `;

    console.log("-> Flushed BTCUSD bot_execution_logs (via orders)");
    console.log("-> Flushed BTCUSD bot_orders");
    console.log("-> Flushed BTCUSD bot_positions");
    console.log("-> Flushed BTCUSD trading_execution_jobs");
    console.log("-> Cleared trendProfitLockRuntime on user_strategy_runs");
    console.log("Cleanup finished successfully.");
  } catch (e) {
    console.error("Cleanup failed:", e);
    process.exitCode = 1;
  } finally {
    await dbClient.end({ timeout: 5 });
  }
}

void main();
