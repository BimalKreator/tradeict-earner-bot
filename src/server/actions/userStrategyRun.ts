"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUserId } from "@/server/auth/require-user";
import {
  strategies,
  userStrategyRuns,
  userStrategySubscriptions,
  users,
} from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { hasValidDeltaIndiaConnectionForTrading } from "@/server/queries/exchange-valid-for-trading";

const subscriptionIdSchema = z.string().uuid();

/** Source states allowed to move to `active` after all gates pass. */
const ACTIVATE_FROM = new Set([
  "ready_to_activate",
  "paused_by_user",
  "paused_exchange_off",
  "paused_insufficient_funds",
  "inactive",
]);

function numericFieldPresent(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return String(raw).trim() !== "";
}

function subscriptionActiveEntitled(
  status: string,
  accessValidUntil: Date,
  now: Date,
): boolean {
  return status === "active" && accessValidUntil.getTime() > now.getTime();
}

export type StrategyRunActionState = {
  ok: boolean | null;
  message: string;
  /** When set, client should show a link to complete capital / leverage. */
  settingsHref?: string;
};

const initialState: StrategyRunActionState = {
  ok: null,
  message: "",
};

export async function activateStrategyRunAction(
  _prev: StrategyRunActionState,
  formData: FormData,
): Promise<StrategyRunActionState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = subscriptionIdSchema.safeParse(
    formData.get("subscriptionId"),
  );
  if (!parsed.success) {
    return { ok: false, message: "Invalid subscription." };
  }
  const subscriptionId = parsed.data;

  const database = requireDb();
  const now = new Date();

  const [row] = await database
    .select({
      subStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      capitalToUseInr: userStrategyRuns.capitalToUseInr,
      leverage: userStrategyRuns.leverage,
      strategyStatus: strategies.status,
      strategyDeletedAt: strategies.deletedAt,
      strategySlug: strategies.slug,
      userApproval: users.approvalStatus,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .where(
      and(
        eq(userStrategySubscriptions.id, subscriptionId),
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "Subscription not found." };
  }

  const settingsPath = `/user/my-strategies/${encodeURIComponent(row.strategySlug)}/settings`;

  if (row.runStatus === "blocked_revenue_due") {
    return {
      ok: false,
      message: "Resolve revenue due before activating this strategy.",
    };
  }
  if (row.runStatus === "paused_revenue_due") {
    return {
      ok: false,
      message: "This strategy cannot be activated while revenue is overdue.",
    };
  }
  if (row.runStatus === "paused_admin") {
    return {
      ok: false,
      message: "This run was paused by support. Contact us to continue.",
    };
  }

  if (!ACTIVATE_FROM.has(row.runStatus)) {
    return {
      ok: false,
      message: "This strategy cannot be activated or resumed from its current state.",
    };
  }

  if (row.userApproval !== "approved") {
    return {
      ok: false,
      message: "Your account must be fully approved before you can run strategies.",
    };
  }

  if (!subscriptionActiveEntitled(row.subStatus, row.accessValidUntil, now)) {
    return {
      ok: false,
      message: "Your subscription must be active with valid access to run this strategy.",
    };
  }

  if (row.strategyDeletedAt != null || row.strategyStatus !== "active") {
    return {
      ok: false,
      message: "This strategy is not available for activation right now.",
    };
  }

  if (
    !numericFieldPresent(row.capitalToUseInr) ||
    !numericFieldPresent(row.leverage)
  ) {
    return {
      ok: false,
      message:
        "Capital and Leverage settings are missing. Save both on the strategy settings page before activating.",
      settingsHref: settingsPath,
    };
  }

  const exchangeOk = await hasValidDeltaIndiaConnectionForTrading(userId);
  if (!exchangeOk) {
    await database
      .update(userStrategyRuns)
      .set({
        status: "paused_exchange_off",
        pausedAt: now,
        lastStateReason: "activate_blocked_no_valid_exchange",
        updatedAt: now,
      })
      .where(eq(userStrategyRuns.id, row.runId));

    revalidatePath("/user/my-strategies");
    return {
      ok: false,
      message:
        "Connect Delta India under Exchange, save API keys, and run a successful connection test before activating. The strategy stays paused until the exchange is ready.",
    };
  }

  await database
    .update(userStrategyRuns)
    .set({
      status: "active",
      activatedAt: now,
      pausedAt: null,
      lastStateReason: null,
      updatedAt: now,
    })
    .where(eq(userStrategyRuns.id, row.runId));

  revalidatePath("/user/my-strategies");
  return { ok: true, message: "Strategy is now active." };
}

export async function pauseStrategyRunAction(
  _prev: StrategyRunActionState,
  formData: FormData,
): Promise<StrategyRunActionState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = subscriptionIdSchema.safeParse(
    formData.get("subscriptionId"),
  );
  if (!parsed.success) {
    return { ok: false, message: "Invalid subscription." };
  }
  const subscriptionId = parsed.data;

  const database = requireDb();
  const now = new Date();

  const [row] = await database
    .select({
      subStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      userApproval: users.approvalStatus,
      strategyStatus: strategies.status,
      strategyDeletedAt: strategies.deletedAt,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .where(
      and(
        eq(userStrategySubscriptions.id, subscriptionId),
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "Subscription not found." };
  }

  if (row.userApproval !== "approved") {
    return { ok: false, message: "Your account is not approved for this action." };
  }

  if (!subscriptionActiveEntitled(row.subStatus, row.accessValidUntil, now)) {
    return {
      ok: false,
      message: "This subscription is not active or access has ended.",
    };
  }

  if (row.strategyDeletedAt != null || row.strategyStatus !== "active") {
    return { ok: false, message: "This strategy is not available." };
  }

  if (row.runStatus !== "active") {
    return { ok: false, message: "Only an active strategy can be paused." };
  }

  await database
    .update(userStrategyRuns)
    .set({
      status: "paused_by_user",
      pausedAt: now,
      lastStateReason: "user_pause",
      updatedAt: now,
    })
    .where(eq(userStrategyRuns.id, row.runId));

  revalidatePath("/user/my-strategies");
  return { ok: true, message: "Strategy paused." };
}

export async function inactivateStrategyRunAction(
  _prev: StrategyRunActionState,
  formData: FormData,
): Promise<StrategyRunActionState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = subscriptionIdSchema.safeParse(
    formData.get("subscriptionId"),
  );
  if (!parsed.success) {
    return { ok: false, message: "Invalid subscription." };
  }
  const subscriptionId = parsed.data;

  const database = requireDb();
  const now = new Date();

  const [row] = await database
    .select({
      subStatus: userStrategySubscriptions.status,
      accessValidUntil: userStrategySubscriptions.accessValidUntil,
      runId: userStrategyRuns.id,
      runStatus: userStrategyRuns.status,
      userApproval: users.approvalStatus,
      strategyStatus: strategies.status,
      strategyDeletedAt: strategies.deletedAt,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .innerJoin(users, eq(userStrategySubscriptions.userId, users.id))
    .where(
      and(
        eq(userStrategySubscriptions.id, subscriptionId),
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "Subscription not found." };
  }

  if (row.userApproval !== "approved") {
    return { ok: false, message: "Your account is not approved for this action." };
  }

  if (!subscriptionActiveEntitled(row.subStatus, row.accessValidUntil, now)) {
    return {
      ok: false,
      message: "This subscription is not active or access has ended.",
    };
  }

  if (row.strategyDeletedAt != null || row.strategyStatus !== "active") {
    return { ok: false, message: "This strategy is not available." };
  }

  if (
    row.runStatus !== "active" &&
    row.runStatus !== "paused_by_user" &&
    row.runStatus !== "paused_insufficient_funds"
  ) {
    return {
      ok: false,
      message:
        "You can only inactivate an active, user-paused, or insufficient-margin-paused strategy.",
    };
  }

  await database
    .update(userStrategyRuns)
    .set({
      status: "inactive",
      pausedAt: now,
      lastStateReason: "user_inactivate",
      updatedAt: now,
    })
    .where(eq(userStrategyRuns.id, row.runId));

  revalidatePath("/user/my-strategies");
  return { ok: true, message: "Strategy trading is turned off for this run." };
}

export { initialState as strategyRunActionInitialState };
