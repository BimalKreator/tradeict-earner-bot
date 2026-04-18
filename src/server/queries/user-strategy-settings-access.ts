import { and, eq, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import {
  hedgeScalpingConfigSchema,
  isHedgeScalpingStrategySlug,
  parseAllowedSymbolsList,
} from "@/lib/hedge-scalping-config";
import { extractHedgeScalpingSymbolFromRunSettingsJson } from "@/lib/user-strategy-run-settings-json";
import { db } from "@/server/db";
import {
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";

import { listUserDeltaIndiaExchangeConnections } from "./user-exchange-connection";
import { ensureMissingStrategyRunsForUser } from "./user-my-strategies";

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
  isHedgeScalpingStrategy: boolean;
  hedgeScalpingAllowedSymbols: string[];
  initialHedgeScalpingSymbol: string | null;
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

  // Keep settings page resilient: if payment flow created a subscription but run
  // init has not happened yet, synthesize the missing run row first.
  await ensureMissingStrategyRunsForUser(userId);

  const [row] = await db
    .select({
      subscriptionId: userStrategySubscriptions.id,
      strategyId: strategies.id,
      strategySlug: strategies.slug,
      strategyName: strategies.name,
      recommendedCapitalInr: strategies.recommendedCapitalInr,
      maxLeverage: strategies.maxLeverage,
      strategySettingsJson: strategies.settingsJson,
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
      primaryExchangeConnectionId: userStrategyRuns.primaryExchangeConnectionId,
      secondaryExchangeConnectionId: userStrategyRuns.secondaryExchangeConnectionId,
      runSettingsJson: userStrategyRuns.runSettingsJson,
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

  const isHedgeScalpingStrategy = isHedgeScalpingStrategySlug(row.strategySlug);
  const hedgeScalpingAllowedSymbols = isHedgeScalpingStrategy
    ? (() => {
        const p = hedgeScalpingConfigSchema.safeParse(row.strategySettingsJson);
        return p.success ? parseAllowedSymbolsList(p.data.general.allowedSymbols) : [];
      })()
    : [];
  const savedSym = extractHedgeScalpingSymbolFromRunSettingsJson(row.runSettingsJson)?.trim().toUpperCase();
  const initialHedgeScalpingSymbol =
    savedSym && hedgeScalpingAllowedSymbols.includes(savedSym)
      ? savedSym
      : (hedgeScalpingAllowedSymbols[0] ?? null);

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
    isHedgeScalpingStrategy,
    hedgeScalpingAllowedSymbols,
    initialHedgeScalpingSymbol,
  };
}
