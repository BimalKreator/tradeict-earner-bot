import Link from "next/link";

import { AdminUserStrategiesTable } from "@/components/admin/AdminUserStrategiesTable";
import { AdminUserStrategiesToolbar } from "@/components/admin/AdminUserStrategiesToolbar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { listStrategiesForAdmin } from "@/server/queries/admin-strategies";
import {
  listAdminUserStrategySubscriptions,
  type AdminUserStrategyRunBucket,
} from "@/server/queries/admin-user-strategies";

export const metadata = { title: "User strategies" };
export const dynamic = "force-dynamic";

const BUCKETS = new Set<AdminUserStrategyRunBucket>([
  "all",
  "active",
  "paused",
  "expired",
  "blocked",
]);

function parseBucket(raw: string | undefined): AdminUserStrategyRunBucket {
  if (raw && BUCKETS.has(raw as AdminUserStrategyRunBucket)) {
    return raw as AdminUserStrategyRunBucket;
  }
  return "all";
}

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminUserStrategiesPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const strategyId =
    typeof sp.strategyId === "string" && sp.strategyId.length > 0
      ? sp.strategyId
      : "";
  const runBucket = parseBucket(
    typeof sp.runBucket === "string" ? sp.runBucket : undefined,
  );
  const expFrom = typeof sp.expFrom === "string" ? sp.expFrom : "";
  const expTo = typeof sp.expTo === "string" ? sp.expTo : "";

  const [rows, strategies] = await Promise.all([
    listAdminUserStrategySubscriptions({
      q: q || undefined,
      strategyId: strategyId || undefined,
      runBucket,
      expFrom: expFrom || undefined,
      expTo: expTo || undefined,
    }),
    listStrategiesForAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Dashboard
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          User strategies
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          All subscriptions with run state, capital, and leverage. Use filters to
          find paused, expired, or revenue-blocked bots.
        </p>
      </div>
      <GlassPanel className="space-y-4">
        <AdminUserStrategiesToolbar
          q={q}
          strategyId={strategyId}
          runBucket={runBucket}
          expFrom={expFrom}
          expTo={expTo}
          strategies={strategies}
        />
        <AdminUserStrategiesTable rows={rows} />
      </GlassPanel>
    </div>
  );
}
