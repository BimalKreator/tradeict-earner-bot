"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUserId } from "@/server/auth/require-user";
import {
  userStrategyRuns,
  userStrategySubscriptions,
} from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import { hasValidDeltaIndiaConnectionForTrading } from "@/server/queries/exchange-valid-for-trading";

const subscriptionIdSchema = z.string().uuid();

const ACTIVATE_FROM: ReadonlySet<string> = new Set([
  "ready_to_activate",
  "paused_by_user",
  "paused_exchange_off",
  "inactive",
]);

export type StrategyRunActionState = {
  ok: boolean | null;
  message: string;
};

const initialState: StrategyRunActionState = { ok: null, message: "" };

function subscriptionEntitled(
  status: string,
  accessValidUntil: Date,
  now: Date,
): boolean {
  if (status === "expired" || status === "cancelled") return false;
  return accessValidUntil.getTime() > now.getTime();
}

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
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
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

  if (!subscriptionEntitled(row.subStatus, row.accessValidUntil, now)) {
    return {
      ok: false,
      message: "This subscription is not active or access has ended.",
    };
  }

  if (!ACTIVATE_FROM.has(row.runStatus)) {
    return {
      ok: false,
      message: "This strategy cannot be activated from its current state.",
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
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      userStrategyRuns,
      eq(userStrategyRuns.subscriptionId, userStrategySubscriptions.id),
    )
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

  if (!subscriptionEntitled(row.subStatus, row.accessValidUntil, now)) {
    return {
      ok: false,
      message: "This subscription is not active or access has ended.",
    };
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

export { initialState as strategyRunActionInitialState };
