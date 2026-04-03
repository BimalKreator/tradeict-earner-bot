import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { UserTransactionsView } from "@/components/user/transactions/UserTransactionsView";
import { requireUserIdForPage } from "@/server/auth/require-user";
import {
  getUserStrategiesForTransactionFilters,
  getUserTransactionsLedger,
  parseTransactionSearchParams,
} from "@/server/queries/user-transactions-ledger";

export const metadata = {
  title: "Transactions",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function UserTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const userId = await requireUserIdForPage("/user/transactions");
  const sp = await searchParams;

  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel className="!p-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Transactions
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sign in to view your trade ledger.
          </p>
          <Link
            href="/login?next=%2Fuser%2Ftransactions"
            className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  const filters = parseTransactionSearchParams(sp);
  const [data, strategyOptions] = await Promise.all([
    getUserTransactionsLedger(userId, filters),
    getUserStrategiesForTransactionFilters(userId),
  ]);

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Transactions
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            Ledger is unavailable (database not configured).
          </p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Trade ledger
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Bot orders and recorded trades in one place. Amounts use IST for date
          filters; timestamps display in Asia/Kolkata.
        </p>
      </div>
      <UserTransactionsView
        data={data}
        filters={filters}
        strategyOptions={strategyOptions}
      />
    </div>
  );
}
