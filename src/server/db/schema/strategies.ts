import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { HedgeScalpingConfig } from "@/lib/hedge-scalping-config";
import type { TrendArbStrategyConfig } from "@/lib/trend-arb-strategy-config";
import {
  strategyRiskLabelEnum,
  strategyStatusEnum,
  strategyVisibilityEnum,
} from "./enums";

export type { HedgeScalpingConfig, TrendArbStrategyConfig };

export const strategies = pgTable(
  "strategies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    /** Default monthly access fee in INR before per-user overrides */
    defaultMonthlyFeeInr: numeric("default_monthly_fee_inr", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("499.00"),
    /** Platform revenue share percent (e.g. 50.00 = 50%) */
    defaultRevenueSharePercent: numeric("default_revenue_share_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("50.00"),
    /** Shown in user catalog when `public`. */
    visibility: strategyVisibilityEnum("visibility").notNull().default("public"),
    status: strategyStatusEnum("status").notNull().default("active"),
    riskLabel: strategyRiskLabelEnum("risk_label").notNull().default("medium"),
    recommendedCapitalInr: numeric("recommended_capital_inr", {
      precision: 14,
      scale: 2,
    }),
    maxLeverage: numeric("max_leverage", { precision: 10, scale: 2 }),
    /** Admin-edited chart series: `[{ "date": "YYYY-MM-DD", "value": number }, ...]` */
    performanceChartJson: jsonb("performance_chart_json").$type<
      { date: string; value: number }[] | null
    >(),
    /**
     * Admin-only strategy execution config (engine-specific).
     * User-facing catalog/subscription UI must never render these internals.
     *
     * Trend-arbitrage (`TrendArbStrategyConfig`) includes e.g. `delta1.d1BreakevenTriggerPct`
     * for optional soft breakeven (trail stop to entry after peak URP reaches the threshold).
     *
     * Hedge Scalping dual-account (`HedgeScalpingConfig`) uses `general` (allowedSymbols list,
     * timeframe, HalfTrend amplitude), `delta1`, and `delta2` — see `hedgeScalpingConfigSchema`.
     */
    settingsJson: jsonb("settings_json").$type<
      | Record<string, unknown>
      | TrendArbStrategyConfig
      | HedgeScalpingConfig
      | null
    >(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("strategies_status_idx").on(t.status),
    index("strategies_deleted_at_idx").on(t.deletedAt),
    index("strategies_visibility_idx").on(t.visibility),
  ],
);

export const strategyPerformanceSnapshots = pgTable(
  "strategy_performance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metricEquityInr: numeric("metric_equity_inr", { precision: 24, scale: 8 }),
    metricReturnPct: numeric("metric_return_pct", { precision: 10, scale: 4 }),
    extraMetrics: jsonb("extra_metrics").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("strategy_perf_strategy_captured_idx").on(
      t.strategyId,
      t.capturedAt,
    ),
  ],
);
