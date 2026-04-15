import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { VirtualRunSection } from "@/components/user/VirtualRunSection";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import {
  listVirtualOrdersForRun,
  listVirtualRunsOverviewForUser,
} from "@/server/queries/virtual-trading-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Virtual trading",
};

export default async function VirtualTradingPage() {
  const userId = await requireUserIdForPage("/user/virtual-trading");

  if (!userId || !db) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Virtual trading
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            {!userId ? (
              <>
                <Link href="/login?next=%2Fuser%2Fvirtual-trading" className="text-[var(--accent)] underline">
                  Sign in
                </Link>{" "}
                to use the paper-trading hub.
              </>
            ) : (
              "Database is not configured."
            )}
          </p>
        </GlassPanel>
      </div>
    );
  }

  const runs = await listVirtualRunsOverviewForUser(userId);
  const ordersByRun = await Promise.all(
    runs.map((r) =>
      listVirtualOrdersForRun({
        userId,
        virtualRunId: r.runId,
        limit: 60,
      }),
    ),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Virtual trading hub
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          Paper-trade any catalog strategy with simulated USD balances. Fills are
          recorded in{" "}
          <code className="text-[var(--accent)]">virtual_bot_orders</code> only — no
          Delta keys, no Cashfree access, and no revenue-share ledgers.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Start a run from{" "}
          <Link href="/user/strategies" className="text-[var(--accent)] underline">
            Strategies
          </Link>{" "}
          using <strong className="text-[var(--text-primary)]">Test Virtually</strong>.
        </p>
      </div>

      {runs.length === 0 ? (
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            You do not have any paper-trading strategies yet. Use{" "}
            <strong className="text-[var(--text-primary)]">Test Virtually</strong> on the
            strategies catalog to create one.
          </p>
        </GlassPanel>
      ) : (
        <div className="space-y-8">
          {runs.map((run, i) => (
            <VirtualRunSection
              key={run.runId}
              run={run}
              orders={ordersByRun[i] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
