import { and, eq, isNull, ne } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import {
  type HedgeScalpingConfig,
  isHedgeScalpingStrategySlug,
  parseAllowedSymbolsList,
} from "@/lib/hedge-scalping-config";
import {
  extractHedgeScalpingSymbolFromRunSettingsJson,
  parseUserStrategyRunSettingsJson,
} from "@/lib/user-strategy-run-settings-json";
import { resolveHedgeScalpingConfigForUi } from "@/server/trading/hedge-scalping/load-hedge-scalping-config";
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
  /** Merged with defaults so legacy rows missing `general.maxEntryDistanceFromSignalPct` etc. are safe for UI. */
  hedgeScalpingResolvedConfig: HedgeScalpingConfig | null;
};

const EDITABLE_RUN_STATUSES = new Set<RunRow["status"]>([
  "active",
  "paused_by_user",
  "ready_to_activate",
  "paused_insufficient_funds",
  "paused_exchange_off",
]);

/**
 * Prefer DB columns; fall back to `run_settings_json.execution` so the UI matches
 * API-only or partially migrated rows without crashing on missing columns.
 */
function deriveCapitalAndLeverageForSettingsUi(row: {
  capitalToUseInr: string | null;
  leverage: string | null;
  runSettingsJson: unknown;
  recommendedCapitalInr: unknown;
}): { capitalToUseInr: string | null; leverage: string | null } {
  const parsed = parseUserStrategyRunSettingsJson(row.runSettingsJson);
  const ex = parsed.execution;

  let capital: string | null =
    row.capitalToUseInr != null && String(row.capitalToUseInr).trim() !== ""
      ? String(row.capitalToUseInr).trim()
      : null;

  if (
    capital == null &&
    typeof ex?.allocatedCapitalUsd === "number" &&
    Number.isFinite(ex.allocatedCapitalUsd) &&
    ex.allocatedCapitalUsd > 0
  ) {
    capital = String(ex.allocatedCapitalUsd);
  }

  if (
    capital == null &&
    typeof ex?.capitalPercentage === "number" &&
    Number.isFinite(ex.capitalPercentage) &&
    ex.capitalPercentage > 0 &&
    ex.capitalPercentage <= 100
  ) {
    const recRaw = row.recommendedCapitalInr;
    const rec =
      recRaw != null
        ? Number(String(recRaw).replace(/,/g, "").trim())
        : NaN;
    if (Number.isFinite(rec) && rec > 0) {
      capital = String((ex.capitalPercentage / 100) * rec);
    }
  }

  let leverage: string | null =
    row.leverage != null && String(row.leverage).trim() !== ""
      ? String(row.leverage).trim()
      : null;

  if (
    leverage == null &&
    typeof ex?.leverage === "number" &&
    Number.isFinite(ex.leverage) &&
    ex.leverage > 0
  ) {
    leverage = String(ex.leverage);
  }

  return { capitalToUseInr: capital, leverage };
}

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
        ne(userStrategySubscriptions.status, "cancelled"),
      ),
    )
    .limit(1);

  if (!row) return null;

  const resolvedSlug =
    typeof row.strategySlug === "string" ? row.strategySlug.trim() : "";
  if (!resolvedSlug) return null;

  const strategyName =
    typeof row.strategyName === "string" && row.strategyName.trim() !== ""
      ? row.strategyName.trim()
      : resolvedSlug;

  if (
    typeof row.subscriptionId !== "string" ||
    row.subscriptionId.trim() === "" ||
    typeof row.runId !== "string" ||
    row.runId.trim() === "" ||
    typeof row.strategyId !== "string" ||
    row.strategyId.trim() === ""
  ) {
    return null;
  }

  const canEditSettings = EDITABLE_RUN_STATUSES.has(row.runStatus);

  let deltaConnections: { id: string; accountLabel: string }[] = [];
  try {
    const raw = await listUserDeltaIndiaExchangeConnections(userId);
    deltaConnections = raw.map((c) => ({
      id: c.id,
      accountLabel:
        typeof c.accountLabel === "string" && c.accountLabel.trim() !== ""
          ? c.accountLabel.trim()
          : "Delta profile",
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("list_delta_connections_for_settings_failed", { userId, msg });
  }

  let isHedgeScalpingStrategy = false;
  let hedgeScalpingResolvedConfig: HedgeScalpingConfig | null = null;
  let hedgeScalpingAllowedSymbols: string[] = [];
  try {
    isHedgeScalpingStrategy = isHedgeScalpingStrategySlug(row.strategySlug);
    hedgeScalpingResolvedConfig = isHedgeScalpingStrategy
      ? resolveHedgeScalpingConfigForUi(row.strategySettingsJson)
      : null;
    const allowedRaw =
      hedgeScalpingResolvedConfig &&
      typeof hedgeScalpingResolvedConfig.general?.allowedSymbols === "string"
        ? hedgeScalpingResolvedConfig.general.allowedSymbols
        : "";
    hedgeScalpingAllowedSymbols = hedgeScalpingResolvedConfig
      ? parseAllowedSymbolsList(allowedRaw)
      : [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("hedge_scalping_settings_ui_failed", { slug: resolvedSlug, msg });
    isHedgeScalpingStrategy = false;
    hedgeScalpingResolvedConfig = null;
    hedgeScalpingAllowedSymbols = [];
  }

  const savedSym = extractHedgeScalpingSymbolFromRunSettingsJson(
    row.runSettingsJson,
  )
    ?.trim()
    .toUpperCase();
  const initialHedgeScalpingSymbol =
    savedSym && hedgeScalpingAllowedSymbols.includes(savedSym)
      ? savedSym
      : (hedgeScalpingAllowedSymbols[0] ?? null);

  const { capitalToUseInr: derivedCapital, leverage: derivedLeverage } =
    deriveCapitalAndLeverageForSettingsUi({
      capitalToUseInr: row.capitalToUseInr,
      leverage: row.leverage,
      runSettingsJson: row.runSettingsJson,
      recommendedCapitalInr: row.recommendedCapitalInr,
    });

  return {
    strategyId: row.strategyId,
    strategySlug: resolvedSlug,
    strategyName,
    recommendedCapitalInr: row.recommendedCapitalInr
      ? String(row.recommendedCapitalInr)
      : null,
    maxLeverage: row.maxLeverage ? String(row.maxLeverage) : null,
    subscriptionId: row.subscriptionId,
    runId: row.runId,
    runStatus: row.runStatus,
    capitalToUseInr: derivedCapital,
    leverage: derivedLeverage,
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
    hedgeScalpingResolvedConfig,
  };
}
