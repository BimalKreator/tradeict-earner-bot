import Link from "next/link";

import { MyStrategyCard } from "@/components/user/MyStrategyCard";
import type { MyStrategyCardViewModel } from "@/components/user/MyStrategyCard";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { remainingAccessCalendarDaysIST } from "@/lib/access-remaining-days-ist";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import {
  listMyStrategiesForUser,
  type MyStrategyRow,
} from "@/server/queries/user-my-strategies";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "My strategies",
};

const USER_CAN_ACTIVATE_FROM = new Set([
  "ready_to_activate",
  "paused_by_user",
  "paused_exchange_off",
  "paused_insufficient_funds",
  "inactive",
]);

const RESUME_BUTTON_STATUSES = new Set([
  "paused_by_user",
  "paused_exchange_off",
  "paused_insufficient_funds",
]);

function subscriptionOkForRunActions(
  row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number],
  now: Date,
  expired: boolean,
): boolean {
  if (expired) return false;
  const until = row.accessValidUntil;
  const untilMs = until instanceof Date ? until.getTime() : NaN;
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  if (Number.isNaN(untilMs) || Number.isNaN(nowMs)) return false;
  return (
    row.subscriptionStatus === "active" &&
    untilMs > nowMs &&
    row.strategyStatus === "active"
  );
}

function settingsFieldsMissing(row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number]): boolean {
  const cap = row.capitalToUseInr?.trim() ?? "";
  const lev = row.leverage?.trim() ?? "";
  return cap === "" || lev === "";
}

function isSubscriptionExpired(
  row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number],
  now: Date,
): boolean {
  const end = row.accessValidUntil;
  const endMs = end instanceof Date ? end.getTime() : NaN;
  if (Number.isNaN(endMs)) return true;
  return (
    now.getTime() >= endMs ||
    row.subscriptionStatus === "expired" ||
    row.subscriptionStatus === "cancelled"
  );
}

/** Last-line defense if DB / mapping ever yields partial rows. */
function isRenderableMyStrategyRow(
  row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number],
): boolean {
  if (
    typeof row.subscriptionId !== "string" ||
    row.subscriptionId.trim() === "" ||
    typeof row.strategyId !== "string" ||
    row.strategyId.trim() === "" ||
    typeof row.slug !== "string" ||
    row.slug.trim() === "" ||
    typeof row.name !== "string" ||
    row.name.trim() === ""
  ) {
    return false;
  }
  const a = row.accessValidUntil;
  const p = row.purchasedAt;
  if (!(a instanceof Date) || Number.isNaN(a.getTime())) return false;
  if (!(p instanceof Date) || Number.isNaN(p.getTime())) return false;
  if (typeof row.monthlyFeeInr !== "string" || row.monthlyFeeInr.trim() === "") {
    return false;
  }
  if (
    typeof row.revenueSharePercent !== "string" ||
    row.revenueSharePercent.trim() === ""
  ) {
    return false;
  }
  return true;
}

function toViewModel(
  row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number],
  now: Date,
): MyStrategyCardViewModel {
  const expired = isSubscriptionExpired(row, now);
  let remainingCalendarDaysIST = 0;
  if (!expired && row.accessValidUntil instanceof Date) {
    try {
      remainingCalendarDaysIST = remainingAccessCalendarDaysIST(
        row.accessValidUntil,
        now,
      );
      if (!Number.isFinite(remainingCalendarDaysIST)) {
        remainingCalendarDaysIST = 0;
      }
    } catch {
      remainingCalendarDaysIST = 0;
    }
  }

  const runOk = subscriptionOkForRunActions(row, now, expired);

  const canActivate =
    runOk && USER_CAN_ACTIVATE_FROM.has(row.runStatus);
  const canPause = runOk && row.runStatus === "active";
  const canUnsubscribe = row.subscriptionStatus !== "cancelled";
  const activateButtonLabel = RESUME_BUTTON_STATUSES.has(row.runStatus)
    ? "Resume Strategy"
    : "Activate Strategy";
  const settingsMissing = runOk && settingsFieldsMissing(row);
  const showRenewCta = expired || remainingCalendarDaysIST <= 7;

  return {
    ...row,
    isSubscriptionExpired: expired,
    remainingCalendarDaysIST,
    canActivate,
    canPause,
    canUnsubscribe,
    activateButtonLabel,
    settingsMissing,
    showRenewCta,
  };
}

export default async function UserMyStrategiesPage() {
  const userId = await requireUserIdForPage("/user/my-strategies");

  if (!userId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            My strategies
          </h1>
          <p className="mt-3 text-sm text-amber-100/90">
            <Link
              href="/login?next=%2Fuser%2Fmy-strategies"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              Sign in
            </Link>{" "}
            to manage your subscriptions and run state.
          </p>
        </div>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          My strategies
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            Database is not configured.
          </p>
        </GlassPanel>
      </div>
    );
  }

  let rows: MyStrategyRow[] = [];
  try {
    rows = await listMyStrategiesForUser(userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("user_my_strategies_page_load_failed", { msg });
  }
  const now = new Date();
  const safeRows = rows.filter(isRenderableMyStrategyRow);
  const vms = safeRows.map((r) => toViewModel(r, now));

  const hasRevenueShareBlock = safeRows.some(
    (r) => r.runStatus === "blocked_revenue_due",
  );

  const active = vms.filter((r) => !r.isSubscriptionExpired && r.runStatus === "active");
  const paused = vms.filter(
    (r) => !r.isSubscriptionExpired && r.runStatus !== "active",
  );
  const expired = vms.filter((r) => r.isSubscriptionExpired);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          My strategies
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          Run state, billing access, and quick actions. Activate requires a tested
          Delta India connection under Exchange.
        </p>
      </div>

      {hasRevenueShareBlock ? (
        <div className="rounded-2xl border border-red-500/35 bg-gradient-to-r from-red-950/45 to-amber-950/25 px-4 py-3 text-sm text-red-100/95 backdrop-blur-sm">
          <p className="font-semibold text-amber-100">
            Action required: bot entries are paused due to pending revenue share.
          </p>
          <p className="mt-1 text-xs text-red-100/80">
            Your strategy may still receive exit orders to close existing
            positions. Settle revenue share to restore new entries.
          </p>
          <Link
            href="/user/funds"
            className="mt-2 inline-block text-xs font-semibold text-[var(--accent)] hover:underline"
          >
            Funds & billing →
          </Link>
        </div>
      ) : null}

      {vms.length === 0 ? (
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            You do not have any strategy subscriptions yet. Browse{" "}
            <a
              href="/user/strategies"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              Strategies
            </a>{" "}
            to subscribe.
          </p>
        </GlassPanel>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Active
            </h2>
            {active.length === 0 ? (
              <GlassPanel className="border border-white/[0.06] bg-black/20">
                <p className="text-sm text-[var(--text-muted)]">
                  No strategies are running right now. Activate one below or fix
                  exchange connection issues.
                </p>
              </GlassPanel>
            ) : (
              <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {active.map((r) => (
                  <li key={r.subscriptionId} className="min-w-0 list-none">
                    <MyStrategyCard row={r} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Paused · action required
            </h2>
            {paused.length === 0 ? (
              <GlassPanel className="border border-white/[0.06] bg-black/20">
                <p className="text-sm text-[var(--text-muted)]">
                  Nothing waiting on you — either everything is active or access
                  has ended.
                </p>
              </GlassPanel>
            ) : (
              <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {paused.map((r) => (
                  <li key={r.subscriptionId} className="min-w-0 list-none">
                    <MyStrategyCard row={r} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Expired
            </h2>
            {expired.length === 0 ? (
              <GlassPanel className="border border-white/[0.06] bg-black/20">
                <p className="text-sm text-[var(--text-muted)]">
                  No expired subscriptions in this list.
                </p>
              </GlassPanel>
            ) : (
              <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {expired.map((r) => (
                  <li key={r.subscriptionId} className="min-w-0 list-none">
                    <MyStrategyCard row={r} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
