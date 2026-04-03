import Link from "next/link";

import { UserStrategyCatalogCard } from "@/components/user/UserStrategyCatalogCard";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { getUserStrategyCatalog } from "@/server/queries/user-strategy-catalog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Strategies",
};

export default async function UserStrategiesPage() {
  const userId = await requireUserIdForPage("/user/strategies");

  if (!db) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Strategies
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            Database is not configured.
          </p>
        </GlassPanel>
      </div>
    );
  }

  const cards = await getUserStrategyCatalog(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Strategies
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          Browse Delta India strategies you can subscribe to. Pricing may reflect
          admin defaults or your personal overrides. Subscribe opens checkout
          (payment in a later release).
        </p>
        {!userId ? (
          <p className="mt-3 text-sm text-amber-100/90">
            <Link href="/login?next=%2Fuser%2Fstrategies" className="text-[var(--accent)] underline">
              Sign in
            </Link>{" "}
            to see your subscription status and custom pricing.
          </p>
        ) : null}
      </div>

      {cards.length === 0 ? (
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            No strategies are available right now. Check back soon.
          </p>
        </GlassPanel>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((s) => (
            <li key={s.id} className="min-w-0 list-none">
              <UserStrategyCatalogCard strategy={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
