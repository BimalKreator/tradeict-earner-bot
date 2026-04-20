import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { UserLivePositionsSection } from "@/components/user/UserLivePositionsSection";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { getUserLiveOpenPositions } from "@/server/queries/live-positions-dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live trades",
};

export default async function UserLiveTradesPage() {
  const userId = await requireUserIdForPage("/user/live-trades");

  if (!userId || !db) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Live trades
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            {!userId ? (
              <>
                <Link href="/login?next=%2Fuser%2Flive-trades" className="text-[var(--accent)] underline">
                  Sign in
                </Link>{" "}
                to view live positions.
              </>
            ) : (
              "Database is not configured."
            )}
          </p>
        </GlassPanel>
      </div>
    );
  }

  const positions = await getUserLiveOpenPositions(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Live trades
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          Open contracts from your connected Delta India profiles — synced from{" "}
          <code className="text-sky-300/90">bot_positions</code> when the venue reports fills. For
          paper-only activity, see{" "}
          <Link href="/user/virtual-trading" className="text-[var(--accent)] underline">
            Virtual trading
          </Link>
          .
        </p>
      </div>

      <UserLivePositionsSection initialRows={positions} />
    </div>
  );
}
