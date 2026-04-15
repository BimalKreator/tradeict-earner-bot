import "dotenv/config";

import { and, desc, eq, ilike, isNull } from "drizzle-orm";

import { db } from "@/server/db";
import {
  exchangeConnections,
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
} from "@/server/db/schema";

async function main() {
  if (!db) {
    console.error("DATABASE_URL is not configured (db is null).");
    process.exitCode = 1;
    return;
  }

  const [strategy] = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      slug: strategies.slug,
    })
    .from(strategies)
    .where(and(ilike(strategies.name, "%Trend Arbitrage%"), isNull(strategies.deletedAt)))
    .orderBy(desc(strategies.updatedAt))
    .limit(1);

  if (!strategy) {
    console.error('No strategy found with name containing "Trend Arbitrage".');
    process.exitCode = 1;
    return;
  }

  const [run] = await db
    .select({
      runId: userStrategyRuns.id,
      userId: userStrategySubscriptions.userId,
      userEmail: users.email,
      primaryExchangeId: userStrategyRuns.primaryExchangeConnectionId,
      secondaryExchangeId: userStrategyRuns.secondaryExchangeConnectionId,
    })
    .from(userStrategyRuns)
    .innerJoin(
      userStrategySubscriptions,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .where(
      and(
        eq(userStrategySubscriptions.strategyId, strategy.id),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .orderBy(desc(userStrategyRuns.updatedAt))
    .limit(1);

  if (!run) {
    console.error(
      `No user_strategy_runs row found for strategy "${strategy.name}" (${strategy.id}).`,
    );
    process.exitCode = 1;
    return;
  }

  const deltaConnections = await db
    .select({
      id: exchangeConnections.id,
      accountLabel: exchangeConnections.accountLabel,
      status: exchangeConnections.status,
      lastTestStatus: exchangeConnections.lastTestStatus,
    })
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, run.userId),
        eq(exchangeConnections.provider, "delta_india"),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .orderBy(desc(exchangeConnections.updatedAt));

  console.log("");
  console.log("Trend Arbitrage IDs");
  console.log("-------------------");
  console.log(`Strategy: ${strategy.name} (${strategy.slug})`);
  console.log(`TA_TREND_ARB_STRATEGY_ID=${strategy.id}`);
  console.log("");
  console.log(`Run: ${run.runId}`);
  console.log(`User: ${run.userId} (${run.userEmail})`);
  console.log(`TA_TREND_ARB_RUN_ID=${run.runId}`);
  console.log("");
  console.log("Delta exchange connections for this user:");
  if (deltaConnections.length === 0) {
    console.log("- none found");
  } else {
    for (const ec of deltaConnections) {
      const roleHint =
        ec.id === run.primaryExchangeId
          ? " (current PRIMARY)"
          : ec.id === run.secondaryExchangeId
            ? " (current SECONDARY)"
            : "";
      console.log(
        `- ${ec.accountLabel}: ${ec.id}${roleHint} [status=${ec.status}, test=${ec.lastTestStatus}]`,
      );
    }
  }

  const primaryCandidate = run.primaryExchangeId ?? deltaConnections[0]?.id ?? "";
  const secondaryCandidate = run.secondaryExchangeId ?? deltaConnections[1]?.id ?? "";

  console.log("");
  console.log("Copy/paste for .env");
  console.log("-------------------");
  console.log(`TA_TREND_ARB_STRATEGY_ID=${strategy.id}`);
  console.log(`TA_TREND_ARB_RUN_ID=${run.runId}`);
  console.log(`TA_TREND_PRIMARY_EXCHANGE_ID=${primaryCandidate}`);
  console.log(`TA_TREND_SECONDARY_EXCHANGE_ID=${secondaryCandidate}`);
  console.log("");
}

void main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("get-trend-ids failed:", msg);
  process.exitCode = 1;
});
