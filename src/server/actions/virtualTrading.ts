"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  hedgeScalpingConfigSchema,
  isHedgeScalpingStrategySlug,
  parseAllowedSymbolsList,
} from "@/lib/hedge-scalping-config";
import { withHedgeScalpingRunSymbol } from "@/lib/user-strategy-run-settings-json";
import { requireUserId } from "@/server/auth/require-user";
import {
  hedgeScalpingVirtualClips,
  hedgeScalpingVirtualRuns,
} from "@/server/db/schema/hedge-scalping";
import {
  strategies,
  users,
  virtualBotOrders,
  virtualStrategyRuns,
} from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { assertStrategyEligibleForVirtualStart } from "@/server/queries/virtual-trading-user";

function parseMoney(raw: unknown): string | null {
  if (raw == null) return null;
  const s = typeof raw === "number" ? String(raw) : String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

export async function startVirtualStrategyRunAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  try {
    const userId = await requireUserId();
    const strategyIdRaw = formData.get("strategyId");
    if (typeof strategyIdRaw !== "string" || !strategyIdRaw.trim()) {
      return { error: "Missing strategy." };
    }
    const strategyId = strategyIdRaw.trim();
    const db = requireDb();

    const okStrat = await assertStrategyEligibleForVirtualStart(strategyId);
    if (!okStrat) {
      return { error: "That strategy is not available for paper trading." };
    }

    const [u] = await db
      .select({ approval: users.approvalStatus })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u || u.approval !== "approved") {
      return { error: "Your account must be approved to start paper trading." };
    }

    const [s] = await db
      .select({
        maxLev: strategies.maxLeverage,
        slug: strategies.slug,
        settingsJson: strategies.settingsJson,
      })
      .from(strategies)
      .where(eq(strategies.id, strategyId))
      .limit(1);

    const defaultLev = s?.maxLev != null ? String(s.maxLev) : "5";
    const now = new Date();

    let runSettingsJson: Record<string, unknown> | null = null;
    if (s && isHedgeScalpingStrategySlug(s.slug)) {
      const parsed = hedgeScalpingConfigSchema.safeParse(s.settingsJson);
      const allowed = parsed.success
        ? parseAllowedSymbolsList(parsed.data.general.allowedSymbols)
        : [];
      if (allowed.length === 0) {
        return { error: "This hedge-scalping strategy has no allowed symbols configured." };
      }
      const sym = String(formData.get("hedge_scalping_symbol") ?? "").trim().toUpperCase();
      if (!sym || !allowed.includes(sym)) {
        return { error: "Choose a valid symbol before starting paper trading." };
      }
      runSettingsJson = withHedgeScalpingRunSymbol(null, sym);
    }

    await db
      .insert(virtualStrategyRuns)
      .values({
        userId,
        strategyId,
        status: "active",
        leverage: defaultLev,
        virtualCapitalUsd: "10000",
        virtualAvailableCashUsd: "10000",
        virtualUsedMarginUsd: "0",
        virtualRealizedPnlUsd: "0",
        openNetQty: "0",
        runSettingsJson,
        activatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [virtualStrategyRuns.userId, virtualStrategyRuns.strategyId],
        set: {
          status: "active",
          pausedAt: null,
          updatedAt: now,
          openNetQty: "0",
          openAvgEntryPrice: null,
          openSymbol: null,
          virtualUsedMarginUsd: "0",
          ...(runSettingsJson != null ? { runSettingsJson } : {}),
        },
      });

    if (s && isHedgeScalpingStrategySlug(s.slug)) {
      const doneAt = new Date();
      await db.transaction(async (tx) => {
        const activeHsRuns = await tx
          .select({ runId: hedgeScalpingVirtualRuns.runId })
          .from(hedgeScalpingVirtualRuns)
          .where(
            and(
              eq(hedgeScalpingVirtualRuns.userId, userId),
              eq(hedgeScalpingVirtualRuns.strategyId, strategyId),
              eq(hedgeScalpingVirtualRuns.status, "active"),
            ),
          );
        const hsRunIds = activeHsRuns.map((r) => r.runId);
        if (hsRunIds.length > 0) {
          await tx
            .update(hedgeScalpingVirtualClips)
            .set({ status: "completed", closedAt: doneAt })
            .where(
              and(
                inArray(hedgeScalpingVirtualClips.runId, hsRunIds),
                eq(hedgeScalpingVirtualClips.status, "active"),
              ),
            );
          await tx
            .update(hedgeScalpingVirtualRuns)
            .set({ status: "completed", closedAt: doneAt })
            .where(
              and(
                eq(hedgeScalpingVirtualRuns.userId, userId),
                eq(hedgeScalpingVirtualRuns.strategyId, strategyId),
                eq(hedgeScalpingVirtualRuns.status, "active"),
              ),
            );
        }
      });
    }

    revalidatePath("/user/virtual-trading");
    revalidatePath("/user/strategies");
    redirect("/user/virtual-trading");
  } catch (e) {
    if (e && typeof e === "object" && "digest" in (e as object)) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : "Could not start paper run.";
    return { error: msg };
  }
}

export async function updateVirtualRunSettingsAction(formData: FormData) {
  const userId = await requireUserId();
  const runId = String(formData.get("virtualRunId") ?? "").trim();
  if (!runId) throw new Error("Missing run.");

  const levRaw = parseMoney(formData.get("leverage"));
  const capRaw = parseMoney(formData.get("virtualCapitalUsd"));
  if (!levRaw || Number(levRaw) <= 0) {
    throw new Error("Leverage must be a positive number.");
  }
  if (!capRaw || Number(capRaw) <= 0) {
    throw new Error("Virtual capital must be a positive number.");
  }

  const db = requireDb();
  const [run] = await db
    .select({
      id: virtualStrategyRuns.id,
      strategyId: virtualStrategyRuns.strategyId,
      openNetQty: virtualStrategyRuns.openNetQty,
    })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.id, runId),
        eq(virtualStrategyRuns.userId, userId),
      ),
    )
    .limit(1);

  if (!run) throw new Error("Run not found.");

  const open = Number(run.openNetQty);
  const flat = !Number.isFinite(open) || Math.abs(open) < 1e-12;

  const [s] = await db
    .select({ maxLev: strategies.maxLeverage })
    .from(strategies)
    .where(eq(strategies.id, run.strategyId))
    .limit(1);

  const maxLev = s?.maxLev != null ? Number(s.maxLev) : null;
  let levN = Number(levRaw);
  if (maxLev != null && Number.isFinite(maxLev) && levN > maxLev) {
    levN = maxLev;
  }

  const now = new Date();
  const patch: Partial<typeof virtualStrategyRuns.$inferInsert> = {
    leverage: String(levN),
    updatedAt: now,
  };

  if (flat) {
    patch.virtualCapitalUsd = capRaw;
    patch.virtualAvailableCashUsd = capRaw;
  }

  await db
    .update(virtualStrategyRuns)
    .set(patch)
    .where(
      and(
        eq(virtualStrategyRuns.id, runId),
        eq(virtualStrategyRuns.userId, userId),
      ),
    );

  revalidatePath("/user/virtual-trading");
}

export async function addVirtualFundsAction(formData: FormData) {
  const userId = await requireUserId();
  const runId = String(formData.get("virtualRunId") ?? "").trim();
  const add = parseMoney(formData.get("amountUsd"));
  if (!runId || !add || Number(add) <= 0) {
    throw new Error("Enter a positive amount.");
  }

  const db = requireDb();
  await db.execute(sql`
    UPDATE virtual_strategy_runs
    SET
      virtual_available_cash_usd = (virtual_available_cash_usd::numeric + ${add}::numeric)::numeric(14,2),
      virtual_capital_usd = (virtual_capital_usd::numeric + ${add}::numeric)::numeric(14,2),
      updated_at = NOW()
    WHERE id = ${runId}::uuid AND user_id = ${userId}::uuid
  `);

  revalidatePath("/user/virtual-trading");
}

export async function resetVirtualRunAction(formData: FormData) {
  const userId = await requireUserId();
  const runId = String(formData.get("virtualRunId") ?? "").trim();
  if (!runId) throw new Error("Missing run.");

  const db = requireDb();
  const [run] = await db
    .select({
      capital: virtualStrategyRuns.virtualCapitalUsd,
    })
    .from(virtualStrategyRuns)
    .where(
      and(
        eq(virtualStrategyRuns.id, runId),
        eq(virtualStrategyRuns.userId, userId),
      ),
    )
    .limit(1);

  if (!run) throw new Error("Run not found.");

  const cap = String(run.capital);

  await db.transaction(async (tx) => {
    await tx
      .delete(virtualBotOrders)
      .where(
        and(
          eq(virtualBotOrders.virtualRunId, runId),
          eq(virtualBotOrders.userId, userId),
        ),
      );

    await tx
      .update(virtualStrategyRuns)
      .set({
        openNetQty: "0",
        openAvgEntryPrice: null,
        openSymbol: null,
        virtualUsedMarginUsd: "0",
        virtualRealizedPnlUsd: "0",
        virtualAvailableCashUsd: cap,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(virtualStrategyRuns.id, runId),
          eq(virtualStrategyRuns.userId, userId),
        ),
      );
  });

  revalidatePath("/user/virtual-trading");
}

export async function pauseVirtualRunAction(formData: FormData) {
  const userId = await requireUserId();
  const runId = String(formData.get("virtualRunId") ?? "").trim();
  if (!runId) throw new Error("Missing run.");
  const db = requireDb();
  const now = new Date();
  await db
    .update(virtualStrategyRuns)
    .set({ status: "paused", pausedAt: now, updatedAt: now })
    .where(
      and(
        eq(virtualStrategyRuns.id, runId),
        eq(virtualStrategyRuns.userId, userId),
      ),
    );
  revalidatePath("/user/virtual-trading");
}

export async function resumeVirtualRunAction(formData: FormData) {
  const userId = await requireUserId();
  const runId = String(formData.get("virtualRunId") ?? "").trim();
  if (!runId) throw new Error("Missing run.");
  const db = requireDb();
  const now = new Date();
  const [run] = await db
    .select({
      strategyId: virtualStrategyRuns.strategyId,
      strategySlug: strategies.slug,
    })
    .from(virtualStrategyRuns)
    .innerJoin(strategies, eq(virtualStrategyRuns.strategyId, strategies.id))
    .where(
      and(
        eq(virtualStrategyRuns.id, runId),
        eq(virtualStrategyRuns.userId, userId),
      ),
    )
    .limit(1);
  if (!run) throw new Error("Run not found.");
  await db
    .update(virtualStrategyRuns)
    .set({
      status: "active",
      pausedAt: null,
      // Ensure "resume" is durable even after internal completed transitions.
      activatedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(virtualStrategyRuns.id, runId),
        eq(virtualStrategyRuns.userId, userId),
      ),
    );
  if (isHedgeScalpingStrategySlug(run.strategySlug)) {
    const activeHsRuns = await db
      .select({ runId: hedgeScalpingVirtualRuns.runId })
      .from(hedgeScalpingVirtualRuns)
      .where(
        and(
          eq(hedgeScalpingVirtualRuns.userId, userId),
          eq(hedgeScalpingVirtualRuns.strategyId, run.strategyId),
          eq(hedgeScalpingVirtualRuns.status, "active"),
        ),
      );
    const hsRunIds = activeHsRuns.map((r) => r.runId);
    if (hsRunIds.length > 0) {
      await db
        .update(hedgeScalpingVirtualClips)
        .set({ status: "completed", closedAt: now })
        .where(
          and(
            inArray(hedgeScalpingVirtualClips.runId, hsRunIds),
            eq(hedgeScalpingVirtualClips.status, "active"),
          ),
        );
      await db
        .update(hedgeScalpingVirtualRuns)
        .set({ status: "completed", closedAt: now })
        .where(inArray(hedgeScalpingVirtualRuns.runId, hsRunIds));
    }
  }
  revalidatePath("/user/virtual-trading");
}
