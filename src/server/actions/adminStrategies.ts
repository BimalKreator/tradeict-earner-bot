"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  chartPointsToDbValue,
  parsePerformanceChartJsonText,
} from "@/lib/strategy-performance-chart";
import {
  defaultHedgeScalpingConfig,
  hedgeScalpingConfigSchema,
  hedgeScalpingTimeframeSchema,
  isHedgeScalpingStrategySlug,
  parseAllowedSymbolsList,
  type HedgeScalpingConfig,
} from "@/lib/hedge-scalping-config";
import {
  trendArbTimeframeSchema,
  trendArbStrategyConfigSchema,
  type TrendArbStrategyConfig,
} from "@/lib/trend-arb-strategy-config";
import { logAdminAction } from "@/server/audit/audit-logger";
import { requireAdminId } from "@/server/auth/require-admin-id";
import { strategies } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

const uuid = z.string().uuid();

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function insertStrategyAudit(
  adminId: string,
  action: string,
  strategyId: string,
  metadata?: Record<string, unknown>,
) {
  await logAdminAction({
    actorAdminId: adminId,
    action,
    entityType: "strategy",
    entityId: strategyId,
    extra: metadata,
  });
}

function revalidateStrategyPaths(strategyId: string) {
  revalidatePath("/admin/strategies");
  revalidatePath(`/admin/strategies/${strategyId}`);
  revalidatePath(`/admin/strategies/${strategyId}/edit`);
  revalidatePath("/admin/dashboard");
}

function parseOptionalInr(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (s === "") return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Recommended capital must be a non-negative number." };
  }
  return { ok: true, value: n.toFixed(2) };
}

function parseOptionalLeverage(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (s === "") return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Max leverage must be a positive number when set." };
  }
  return { ok: true, value: n.toFixed(2) };
}

const lifecycleStatusSchema = z.enum(["active", "paused", "archived"]);

const baseFieldsSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  description: z.string().trim().max(8000).optional().default(""),
  default_monthly_fee_inr: z
    .string()
    .trim()
    .refine((s) => s.length > 0, "Monthly fee required")
    .refine((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0;
    }, "Monthly fee must be 0 or greater"),
  default_revenue_share_percent: z
    .string()
    .trim()
    .refine((s) => s.length > 0, "Revenue share required")
    .refine((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    }, "Revenue share must be 0–100"),
  visibility: z.enum(["public", "hidden"]),
  status: lifecycleStatusSchema,
  risk_label: z.enum(["low", "medium", "high"]),
  performance_chart_json: z.string().optional().default(""),
});

export type StrategyFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parsePercentField(
  raw: unknown,
  fieldLabel: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: `${fieldLabel} is required.` };
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${fieldLabel} must be a valid number.` };
  }
  return { ok: true, value: n };
}

function parseTrendArbConfigFromForm(
  formData: FormData,
): { ok: true; value: TrendArbStrategyConfig } | { ok: false; fieldErrors: Record<string, string[]> } {
  const symbol = String(formData.get("trend_arb_symbol") ?? "").trim();
  const cap = parsePercentField(
    formData.get("trend_arb_capital_allocation_pct"),
    "Capital usage %",
  );
  const d1Qty = parsePercentField(
    formData.get("trend_arb_d1_entry_qty_pct"),
    "Delta 1 base qty %",
  );
  const d1Tp = parsePercentField(
    formData.get("trend_arb_d1_target_profit_pct"),
    "Delta 1 target profit %",
  );
  const d1Sl = parsePercentField(
    formData.get("trend_arb_d1_stop_loss_pct"),
    "Delta 1 stop loss %",
  );
  const d1BeRaw = String(formData.get("trend_arb_d1_breakeven_trigger_pct") ?? "").trim();
  const d1BreakevenTrigger =
    d1BeRaw === ""
      ? ({ ok: true as const, value: 0 })
      : parsePercentField(
          formData.get("trend_arb_d1_breakeven_trigger_pct"),
          "D1 breakeven trigger %",
        );
  const d2StepQty = parsePercentField(
    formData.get("trend_arb_d2_step_qty_pct"),
    "Delta 2 step qty %",
  );
  const d2StepMove = parsePercentField(
    formData.get("trend_arb_d2_step_move_pct"),
    "Delta 2 step move %",
  );
  const d2Tp = parsePercentField(
    formData.get("trend_arb_d2_target_profit_pct"),
    "Delta 2 target profit %",
  );
  const d2Sl = parsePercentField(
    formData.get("trend_arb_d2_stop_loss_pct"),
    "Delta 2 stop loss %",
  );
  const indicatorAmplitude = parsePercentField(
    formData.get("trend_arb_indicator_amplitude"),
    "HalfTrend amplitude",
  );
  const indicatorChannelDeviation = parsePercentField(
    formData.get("trend_arb_indicator_channel_deviation"),
    "Channel deviation",
  );
  const indicatorTimeframeRaw = String(
    formData.get("trend_arb_indicator_timeframe") ?? "",
  ).trim();
  const indicatorTimeframe = trendArbTimeframeSchema.safeParse(indicatorTimeframeRaw);

  const parseErrors: Record<string, string[]> = {};
  if (!cap.ok) parseErrors.trend_arb_capital_allocation_pct = [cap.error];
  if (!d1Qty.ok) parseErrors.trend_arb_d1_entry_qty_pct = [d1Qty.error];
  if (!d1Tp.ok) parseErrors.trend_arb_d1_target_profit_pct = [d1Tp.error];
  if (!d1Sl.ok) parseErrors.trend_arb_d1_stop_loss_pct = [d1Sl.error];
  if (!d1BreakevenTrigger.ok) {
    parseErrors.trend_arb_d1_breakeven_trigger_pct = [d1BreakevenTrigger.error];
  }
  if (!d2StepQty.ok) parseErrors.trend_arb_d2_step_qty_pct = [d2StepQty.error];
  if (!d2StepMove.ok) parseErrors.trend_arb_d2_step_move_pct = [d2StepMove.error];
  if (!d2Tp.ok) parseErrors.trend_arb_d2_target_profit_pct = [d2Tp.error];
  if (!d2Sl.ok) parseErrors.trend_arb_d2_stop_loss_pct = [d2Sl.error];
  if (!indicatorAmplitude.ok) {
    parseErrors.trend_arb_indicator_amplitude = [indicatorAmplitude.error];
  }
  if (!indicatorChannelDeviation.ok) {
    parseErrors.trend_arb_indicator_channel_deviation = [
      indicatorChannelDeviation.error,
    ];
  }
  if (!indicatorTimeframe.success) {
    parseErrors.trend_arb_indicator_timeframe = ["Indicator timeframe is invalid."];
  }
  if (Object.keys(parseErrors).length > 0) {
    return { ok: false, fieldErrors: parseErrors };
  }

  const capValue = cap.ok ? cap.value : 0;
  const d1QtyValue = d1Qty.ok ? d1Qty.value : 0;
  const d1TpValue = d1Tp.ok ? d1Tp.value : 0;
  const d1SlValue = d1Sl.ok ? d1Sl.value : 0;
  const d1BreakevenTriggerValue = d1BreakevenTrigger.ok ? d1BreakevenTrigger.value : 0;
  const d2StepQtyValue = d2StepQty.ok ? d2StepQty.value : 0;
  const d2StepMoveValue = d2StepMove.ok ? d2StepMove.value : 0;
  const d2TpValue = d2Tp.ok ? d2Tp.value : 0;
  const d2SlValue = d2Sl.ok ? d2Sl.value : 0;
  const indicatorAmplitudeValue = indicatorAmplitude.ok ? indicatorAmplitude.value : 0;
  const indicatorChannelDeviationValue = indicatorChannelDeviation.ok
    ? indicatorChannelDeviation.value
    : 0;

  const cfgParsed = trendArbStrategyConfigSchema.safeParse({
    symbol,
    capitalAllocationPct: capValue,
    indicatorSettings: {
      amplitude: indicatorAmplitudeValue,
      channelDeviation: indicatorChannelDeviationValue,
      timeframe: indicatorTimeframe.success ? indicatorTimeframe.data : "4h",
    },
    delta1: {
      entryQtyPct: d1QtyValue,
      targetProfitPct: d1TpValue,
      stopLossPct: d1SlValue,
      d1BreakevenTriggerPct: d1BreakevenTriggerValue,
    },
    delta2: {
      stepQtyPct: d2StepQtyValue,
      stepMovePct: d2StepMoveValue,
      targetProfitPct: d2TpValue,
      stopLossPct: d2SlValue,
    },
  });
  if (!cfgParsed.success) {
    const f = cfgParsed.error.flatten().fieldErrors;
    const errs: Record<string, string[]> = {};
    for (const iss of cfgParsed.error.issues) {
      if (iss.path[0] === "delta1" && iss.path[1] === "d1BreakevenTriggerPct") {
        errs.trend_arb_d1_breakeven_trigger_pct = [iss.message];
      }
    }
    if (f.symbol?.length) errs.trend_arb_symbol = f.symbol;
    if (f.capitalAllocationPct?.length) {
      errs.trend_arb_capital_allocation_pct = f.capitalAllocationPct;
    }
    if (f.indicatorSettings?.length) {
      errs.trend_arb_indicator_amplitude = f.indicatorSettings;
    }
    if (f.delta1?.length) errs.trend_arb_d1_entry_qty_pct = f.delta1;
    if (f.delta2?.length) errs.trend_arb_d2_step_qty_pct = f.delta2;
    return { ok: false, fieldErrors: errs };
  }

  return { ok: true, value: cfgParsed.data };
}

function parseFiniteNumberField(
  raw: unknown,
  fieldLabel: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: `${fieldLabel} is required.` };
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${fieldLabel} must be a valid number.` };
  }
  return { ok: true, value: n };
}

function parseHedgeScalpingConfigFromForm(
  formData: FormData,
): { ok: true; value: HedgeScalpingConfig } | { ok: false; fieldErrors: Record<string, string[]> } {
  const allowedSymbols = String(formData.get("hs_allowed_symbols") ?? "").trim();
  const timeframeRaw = String(formData.get("hs_general_timeframe") ?? "").trim();
  const timeframe = hedgeScalpingTimeframeSchema.safeParse(timeframeRaw);

  const amp = parseFiniteNumberField(
    formData.get("hs_general_half_trend_amplitude"),
    "HalfTrend amplitude",
  );
  const d1Base = parsePercentField(formData.get("hs_d1_base_qty_pct"), "D1 base qty %");
  const d1Tp = parsePercentField(formData.get("hs_d1_target_profit_pct"), "D1 target profit %");
  const d1Sl = parsePercentField(formData.get("hs_d1_stop_loss_pct"), "D1 stop loss %");
  const d1Be = parsePercentField(
    formData.get("hs_d1_breakeven_trigger_pct"),
    "D1 breakeven trigger %",
  );
  const d2Move = parsePercentField(formData.get("hs_d2_step_move_pct"), "D2 step move %");
  const d2Qty = parsePercentField(formData.get("hs_d2_step_qty_pct"), "D2 step qty %");
  const d2Tp = parsePercentField(formData.get("hs_d2_target_profit_pct"), "D2 target profit %");
  const d2Sl = parsePercentField(formData.get("hs_d2_stop_loss_pct"), "D2 stop loss %");

  const parseErrors: Record<string, string[]> = {};
  if (!allowedSymbols) {
    parseErrors.hs_allowed_symbols = ["Allowed symbols are required."];
  } else if (parseAllowedSymbolsList(allowedSymbols).length === 0) {
    parseErrors.hs_allowed_symbols = ["Enter at least one valid symbol (comma-separated)."];
  }
  if (!timeframe.success) parseErrors.hs_general_timeframe = ["Timeframe is invalid."];
  if (!amp.ok) parseErrors.hs_general_half_trend_amplitude = [amp.error];
  if (!d1Base.ok) parseErrors.hs_d1_base_qty_pct = [d1Base.error];
  if (!d1Tp.ok) parseErrors.hs_d1_target_profit_pct = [d1Tp.error];
  if (!d1Sl.ok) parseErrors.hs_d1_stop_loss_pct = [d1Sl.error];
  if (!d1Be.ok) parseErrors.hs_d1_breakeven_trigger_pct = [d1Be.error];
  if (!d2Move.ok) parseErrors.hs_d2_step_move_pct = [d2Move.error];
  if (!d2Qty.ok) parseErrors.hs_d2_step_qty_pct = [d2Qty.error];
  if (!d2Tp.ok) parseErrors.hs_d2_target_profit_pct = [d2Tp.error];
  if (!d2Sl.ok) parseErrors.hs_d2_stop_loss_pct = [d2Sl.error];
  if (Object.keys(parseErrors).length > 0) {
    return { ok: false, fieldErrors: parseErrors };
  }

  const cfgParsed = hedgeScalpingConfigSchema.safeParse({
    general: {
      allowedSymbols,
      timeframe: timeframe.success ? timeframe.data : "5m",
      halfTrendAmplitude: amp.ok ? amp.value : 2,
    },
    delta1: {
      baseQtyPct: d1Base.ok ? d1Base.value : 100,
      targetProfitPct: d1Tp.ok ? d1Tp.value : 5,
      stopLossPct: d1Sl.ok ? d1Sl.value : 1,
      breakevenTriggerPct: d1Be.ok ? d1Be.value : 30,
    },
    delta2: {
      stepMovePct: d2Move.ok ? d2Move.value : 0.5,
      stepQtyPct: d2Qty.ok ? d2Qty.value : 10,
      targetProfitPct: d2Tp.ok ? d2Tp.value : 0.5,
      stopLossPct: d2Sl.ok ? d2Sl.value : 5,
    },
  });

  if (!cfgParsed.success) {
    const errs: Record<string, string[]> = {};
    for (const iss of cfgParsed.error.issues) {
      const path = iss.path.join(".");
      if (path === "general.allowedSymbols" || path.startsWith("general.")) {
        errs.hs_allowed_symbols = [iss.message];
      } else if (path.startsWith("delta1")) {
        errs.hs_d1_base_qty_pct = [iss.message];
      } else if (path.startsWith("delta2")) {
        errs.hs_d2_step_move_pct = [iss.message];
      }
    }
    return { ok: false, fieldErrors: errs };
  }

  return { ok: true, value: cfgParsed.data };
}

export async function createStrategyAction(
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const slugRaw = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slugRaw)) {
    return {
      fieldErrors: {
        slug: [
          "Use lowercase letters, numbers, and single hyphens (e.g. momentum-btc).",
        ],
      },
    };
  }

  const chartParsed = parsePerformanceChartJsonText(
    String(formData.get("performance_chart_json") ?? ""),
  );
  if (!chartParsed.ok) {
    return { fieldErrors: { performance_chart_json: [chartParsed.error] } };
  }

  const cap = parseOptionalInr(formData.get("recommended_capital_inr"));
  if (!cap.ok) return { fieldErrors: { recommended_capital_inr: [cap.error] } };
  const lev = parseOptionalLeverage(formData.get("max_leverage"));
  if (!lev.ok) return { fieldErrors: { max_leverage: [lev.error] } };

  const parsed = baseFieldsSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    default_monthly_fee_inr: formData.get("default_monthly_fee_inr"),
    default_revenue_share_percent: formData.get("default_revenue_share_percent"),
    visibility: formData.get("visibility"),
    status: formData.get("status"),
    risk_label: formData.get("risk_label"),
    performance_chart_json: formData.get("performance_chart_json"),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const fee = Number(parsed.data.default_monthly_fee_inr).toFixed(2);
  const rev = Number(parsed.data.default_revenue_share_percent).toFixed(2);
  const chartDb = chartPointsToDbValue(chartParsed.points);
  const desc =
    parsed.data.description.trim() === "" ? null : parsed.data.description.trim();

  const database = requireDb();
  const now = new Date();

  let newId: string;
  try {
    const [row] = await database
      .insert(strategies)
      .values({
        slug: slugRaw,
        name: parsed.data.name.trim(),
        description: desc,
        defaultMonthlyFeeInr: fee,
        defaultRevenueSharePercent: rev,
        visibility: parsed.data.visibility,
        status: parsed.data.status,
        riskLabel: parsed.data.risk_label,
        recommendedCapitalInr: cap.value,
        maxLeverage: lev.value,
        performanceChartJson: chartDb,
        settingsJson: isHedgeScalpingStrategySlug(slugRaw)
          ? defaultHedgeScalpingConfig()
          : null,
        updatedAt: now,
      })
      .returning({ id: strategies.id });
    newId = row!.id;
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === "23505") {
      return { fieldErrors: { slug: ["That slug is already in use."] } };
    }
    throw e;
  }

  await insertStrategyAudit(adminId, "strategy.created", newId, {
    slug: slugRaw,
    name: parsed.data.name.trim(),
  });
  revalidateStrategyPaths(newId);
  redirect(`/admin/strategies/${newId}`);
}

export async function updateStrategyAction(
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const idParsed = uuid.safeParse(formData.get("strategy_id"));
  if (!idParsed.success) return { error: "Invalid strategy." };

  const chartParsed = parsePerformanceChartJsonText(
    String(formData.get("performance_chart_json") ?? ""),
  );
  if (!chartParsed.ok) {
    return { fieldErrors: { performance_chart_json: [chartParsed.error] } };
  }

  const cap = parseOptionalInr(formData.get("recommended_capital_inr"));
  if (!cap.ok) return { fieldErrors: { recommended_capital_inr: [cap.error] } };
  const lev = parseOptionalLeverage(formData.get("max_leverage"));
  if (!lev.ok) return { fieldErrors: { max_leverage: [lev.error] } };

  const parsed = baseFieldsSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    default_monthly_fee_inr: formData.get("default_monthly_fee_inr"),
    default_revenue_share_percent: formData.get("default_revenue_share_percent"),
    visibility: formData.get("visibility"),
    status: formData.get("status"),
    risk_label: formData.get("risk_label"),
    performance_chart_json: formData.get("performance_chart_json"),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const database = requireDb();
  const [existing] = await database
    .select()
    .from(strategies)
    .where(
      and(eq(strategies.id, idParsed.data), isNull(strategies.deletedAt)),
    )
    .limit(1);
  if (!existing) return { error: "Strategy not found." };

  const fee = Number(parsed.data.default_monthly_fee_inr).toFixed(2);
  const rev = Number(parsed.data.default_revenue_share_percent).toFixed(2);
  const chartDb = chartPointsToDbValue(chartParsed.points);
  const desc =
    parsed.data.description.trim() === "" ? null : parsed.data.description.trim();
  const now = new Date();

  const patch = {
    name: parsed.data.name.trim(),
    description: desc,
    defaultMonthlyFeeInr: fee,
    defaultRevenueSharePercent: rev,
    visibility: parsed.data.visibility,
    status: parsed.data.status,
    riskLabel: parsed.data.risk_label,
    recommendedCapitalInr: cap.value,
    maxLeverage: lev.value,
    performanceChartJson: chartDb,
    settingsJson: existing.settingsJson as Record<string, unknown> | null,
    updatedAt: now,
  };

  const slugNorm = existing.slug.trim().toLowerCase();
  if (isHedgeScalpingStrategySlug(existing.slug)) {
    const parsedHs = parseHedgeScalpingConfigFromForm(formData);
    if (!parsedHs.ok) {
      return { fieldErrors: parsedHs.fieldErrors };
    }
    patch.settingsJson = parsedHs.value;
  } else if (slugNorm.includes("trend-arb")) {
    const parsedTrend = parseTrendArbConfigFromForm(formData);
    if (!parsedTrend.ok) {
      return { fieldErrors: parsedTrend.fieldErrors };
    }
    patch.settingsJson = parsedTrend.value;
  }

  await database
    .update(strategies)
    .set(patch)
    .where(eq(strategies.id, idParsed.data));

  await insertStrategyAudit(adminId, "strategy.updated", idParsed.data, {
    changed: Object.keys(patch),
    slug: existing.slug,
  });

  revalidateStrategyPaths(idParsed.data);
  redirect(`/admin/strategies/${idParsed.data}`);
}

/** Form `action` — must return void for Next.js typing. */
export async function setStrategyVisibilityAction(
  formData: FormData,
): Promise<void> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    console.warn("[admin] setStrategyVisibility: not authorized");
    return;
  }

  const idParsed = uuid.safeParse(formData.get("strategy_id"));
  const vis = z.enum(["public", "hidden"]).safeParse(formData.get("visibility"));
  if (!idParsed.success || !vis.success) {
    console.warn("[admin] setStrategyVisibility: invalid form");
    return;
  }

  const database = requireDb();
  const [row] = await database
    .select({ id: strategies.id, visibility: strategies.visibility, slug: strategies.slug })
    .from(strategies)
    .where(and(eq(strategies.id, idParsed.data), isNull(strategies.deletedAt)))
    .limit(1);
  if (!row) return;
  if (row.visibility === vis.data) return;

  await database
    .update(strategies)
    .set({ visibility: vis.data, updatedAt: new Date() })
    .where(eq(strategies.id, row.id));

  await insertStrategyAudit(
    adminId,
    "strategy.visibility_changed",
    row.id,
    { from: row.visibility, to: vis.data, slug: row.slug },
  );
  revalidateStrategyPaths(row.id);
}

/** Form `action` — must return void for Next.js typing. */
export async function setStrategyStatusAction(formData: FormData): Promise<void> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    console.warn("[admin] setStrategyStatus: not authorized");
    return;
  }

  const idParsed = uuid.safeParse(formData.get("strategy_id"));
  const st = lifecycleStatusSchema.safeParse(formData.get("status"));
  if (!idParsed.success || !st.success) {
    console.warn("[admin] setStrategyStatus: invalid form");
    return;
  }

  const database = requireDb();
  const [row] = await database
    .select({ id: strategies.id, status: strategies.status, slug: strategies.slug })
    .from(strategies)
    .where(and(eq(strategies.id, idParsed.data), isNull(strategies.deletedAt)))
    .limit(1);
  if (!row) return;
  if (row.status === st.data) return;

  const fromStatus = row.status;
  await database
    .update(strategies)
    .set({ status: st.data, updatedAt: new Date() })
    .where(eq(strategies.id, row.id));

  await insertStrategyAudit(
    adminId,
    "strategy.status_changed",
    row.id,
    { from: fromStatus, to: st.data, slug: row.slug },
  );
  revalidateStrategyPaths(row.id);
}
