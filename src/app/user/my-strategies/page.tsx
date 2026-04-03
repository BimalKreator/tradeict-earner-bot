import Link from "next/link";

import { MyStrategyCard } from "@/components/user/MyStrategyCard";
import type { MyStrategyCardViewModel } from "@/components/user/MyStrategyCard";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { remainingAccessCalendarDaysIST } from "@/lib/access-remaining-days-ist";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { listMyStrategiesForUser } from "@/server/queries/user-my-strategies";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "My strategies",
};

const USER_CAN_ACTIVATE_FROM = new Set([
  "ready_to_activate",
  "paused_by_user",
  "paused_exchange_off",
  "inactive",
]);

function isSubscriptionExpired(
  row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number],
  now: Date,
): boolean {
  return (
    now.getTime() >= row.accessValidUntil.getTime() ||
    row.subscriptionStatus === "expired" ||
    row.subscriptionStatus === "cancelled"
  );
}

function toViewModel(
  row: Awaited<ReturnType<typeof listMyStrategiesForUser>>[number],
  now: Date,
): MyStrategyCardViewModel {
  const expired = isSubscriptionExpired(row, now);
  const remainingCalendarDaysIST = expired
    ? 0
    : remainingAccessCalendarDaysIST(row.accessValidUntil, now);

  const canActivate =
    !expired && USER_CAN_ACTIVATE_FROM.has(row.runStatus);
  const canPause = !expired && row.runStatus === "active";
  const showRenewCta = expired || remainingCalendarDaysIST <= 7;

  return {
    ...row,
    isSubscriptionExpired: expired,
    remainingCalendarDaysIST,
    canActivate,
    canPause,
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

  const rows = await listMyStrategiesForUser(userId);
  const now = new Date();
  const vms = rows.map((r) => toViewModel(r, now));

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
