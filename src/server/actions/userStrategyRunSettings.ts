"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ZodIssue } from "zod";

import {
  createUserStrategyRunSettingsSchema,
  type UserStrategySettingsConstraints,
} from "@/lib/user-strategy-settings-schema";
import { requireUserId } from "@/server/auth/require-user";
import { logAuditEvent } from "@/server/audit/audit-logger";
import type { Database } from "@/server/db";
import { strategies, userStrategyRuns, userStrategySubscriptions } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

export type UserStrategySettingsActionState = {
  ok: boolean | null;
  message: string;
  fieldErrors: Record<string, string>;
};

export const userStrategySettingsActionInitialState: UserStrategySettingsActionState =
  {
    ok: null,
    message: "",
    fieldErrors: {},
  };

function toNumericString(n: number): string {
  return n.toFixed(2);
}

function parsePositiveNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function zodIssuesToFieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const iss of issues) {
    const key = iss.path[0];
    if (typeof key === "string" && out[key] == null) {
      out[key] = iss.message;
    }
  }
  return out;
}

const EDITABLE = new Set<string>([
  "active",
  "paused_by_user",
  "ready_to_activate",
]);

export async function updateUserStrategySettingsAction(
  _prev: UserStrategySettingsActionState,
  formData: FormData,
): Promise<UserStrategySettingsActionState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return {
      ok: false,
      message: "Please sign in to continue.",
      fieldErrors: {},
    };
  }

  const slug = String(formData.get("strategySlug") ?? "").trim();
  if (!slug) {
    return {
      ok: false,
      message: "Invalid strategy.",
      fieldErrors: {},
    };
  }

  const capitalRaw = String(formData.get("capitalToUseInr") ?? "");
  const leverageRaw = String(formData.get("leverage") ?? "");

  const database = requireDb();

  const [row] = await database
    .select({
      subscriptionId: userStrategySubscriptions.id,
      strategySlug: strategies.slug,
      recommendedCapitalInr: strategies.recommendedCapitalInr,
      maxLeverage: strategies.maxLeverage,
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
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

  if (!row) {
    return {
      ok: false,
      message: "Subscription not found.",
      fieldErrors: {},
    };
  }

  if (!EDITABLE.has(row.runStatus)) {
    return {
      ok: false,
      message:
        "Settings cannot be changed while the strategy run is in this state.",
      fieldErrors: {},
    };
  }

  const constraints: UserStrategySettingsConstraints = {
    recommendedCapitalInr: row.recommendedCapitalInr
      ? String(row.recommendedCapitalInr)
      : null,
    maxLeverage: row.maxLeverage ? String(row.maxLeverage) : null,
  };

  const schema = createUserStrategyRunSettingsSchema(constraints);
  const parsed = schema.safeParse({
    capitalToUseInr: capitalRaw,
    leverage: leverageRaw,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Fix the highlighted fields.",
      fieldErrors: zodIssuesToFieldErrors(parsed.error.issues),
    };
  }

  const maxLevStr =
    constraints.maxLeverage != null &&
    String(constraints.maxLeverage).trim() !== ""
      ? String(constraints.maxLeverage)
      : null;
  const maxLevNum = maxLevStr != null ? Number(maxLevStr) : null;

  const cap = parsePositiveNumber(parsed.data.capitalToUseInr);
  if (cap == null) {
    return {
      ok: false,
      message: "Invalid capital.",
      fieldErrors: { capitalToUseInr: "Capital must be a positive number." },
    };
  }

  const oldCapital = row.capitalToUseInr ? String(row.capitalToUseInr) : null;
  const oldLeverage = row.leverage ? String(row.leverage) : null;

  let newCapitalStr = toNumericString(cap);
  let newLeverageStr: string | null;

  if (maxLevNum == null || !Number.isFinite(maxLevNum)) {
    newLeverageStr = oldLeverage;
  } else {
    const lev = parsePositiveNumber(parsed.data.leverage);
    if (lev == null) {
      return {
        ok: false,
        message: "Invalid leverage.",
        fieldErrors: { leverage: "Leverage must be a positive number." },
      };
    }
    newLeverageStr = toNumericString(lev);
  }

  const now = new Date();

  await database.transaction(async (tx) => {
    await tx
      .update(userStrategyRuns)
      .set({
        capitalToUseInr: newCapitalStr,
        leverage: newLeverageStr,
        updatedAt: now,
      })
      .where(eq(userStrategyRuns.id, row.runId));

    await logAuditEvent({
      actorType: "user",
      actorUserId: userId,
      action: "strategy_run.settings_updated",
      entityType: "user_strategy_run",
      entityId: row.runId,
      metadata: {
        old_values: {
          capital_to_use_inr: oldCapital,
          leverage: oldLeverage,
        },
        new_values: {
          capital_to_use_inr: newCapitalStr,
          leverage: newLeverageStr,
        },
        strategy_slug: row.strategySlug,
        subscription_id: row.subscriptionId,
      },
      tx,
    });
  });

  revalidatePath("/user/my-strategies");
  revalidatePath(`/user/my-strategies/${encodeURIComponent(slug)}/settings`);

  return {
    ok: true,
    message: "Settings saved.",
    fieldErrors: {},
  };
}
