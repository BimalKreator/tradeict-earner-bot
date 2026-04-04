"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  chartPointsToDbValue,
  parsePerformanceChartJsonText,
} from "@/lib/strategy-performance-chart";
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
    .min(1, "Monthly fee required")
    .refine((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0;
    }, "Invalid monthly fee"),
  default_revenue_share_percent: z
    .string()
    .trim()
    .min(1, "Revenue share required")
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
    updatedAt: now,
  };

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
