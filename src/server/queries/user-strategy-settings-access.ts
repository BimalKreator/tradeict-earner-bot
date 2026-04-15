import { and, eq, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@/server/db";
import {
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";

import { listUserDeltaIndiaExchangeConnections } from "./user-exchange-connection";

type RunRow = InferSelectModel<typeof userStrategyRuns>;

export type UserStrategySettingsPageData = {
  strategyId: string;
  strategySlug: string;
  strategyName: string;
  recommendedCapitalInr: string | null;
  maxLeverage: string | null;
  subscriptionId: string;
  runId: string;
  runStatus: RunRow["status"];
  capitalToUseInr: string | null;
  leverage: string | null;
  primaryExchangeConnectionId: string | null;
  secondaryExchangeConnectionId: string | null;
  deltaConnections: { id: string; accountLabel: string }[];
  canEditSettings: boolean;
};

const EDITABLE_RUN_STATUSES = new Set<RunRow["status"]>([
  "active",
  "paused_by_user",
  "ready_to_activate",
  "paused_insufficient_funds",
  "paused_exchange_off",
]);

export async function getUserStrategySettingsPageData(
  userId: string,
  strategySlug: string,
): Promise<UserStrategySettingsPageData | null> {
  if (!db) return null;
  const slug = strategySlug.trim();
  if (!slug) return null;

  const [row] = await db
    .select({
      subscriptionId: userStrategySubscriptions.id,
      strategyId: strategies.id,
      strategySlug: strategies.slug,
      strategyName: strategies.name,
      recommendedCapitalInr: strategies.recommendedCapitalInr,
      maxLeverage: strategies.maxLeverage,
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
      primaryExchangeConnectionId: userStrategyRuns.primaryExchangeConnectionId,
      secondaryExchangeConnectionId: userStrategyRuns.secondaryExchangeConnectionId,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        eq(strategies.slug, slug),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const canEditSettings = EDITABLE_RUN_STATUSES.has(row.runStatus);

  const deltaConnections = await listUserDeltaIndiaExchangeConnections(userId);

  return {
    strategyId: row.strategyId,
    strategySlug: row.strategySlug,
    strategyName: row.strategyName,
    recommendedCapitalInr: row.recommendedCapitalInr
      ? String(row.recommendedCapitalInr)
      : null,
    maxLeverage: row.maxLeverage ? String(row.maxLeverage) : null,
    subscriptionId: row.subscriptionId,
    runId: row.runId,
    runStatus: row.runStatus,
    capitalToUseInr: row.capitalToUseInr
      ? String(row.capitalToUseInr)
      : null,
    leverage: row.leverage ? String(row.leverage) : null,
    primaryExchangeConnectionId: row.primaryExchangeConnectionId,
    secondaryExchangeConnectionId: row.secondaryExchangeConnectionId,
    deltaConnections: deltaConnections.map((c) => ({
      id: c.id,
      accountLabel: c.accountLabel,
    })),
    canEditSettings,
  };
}
