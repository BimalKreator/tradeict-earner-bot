import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { UserFundsPlatformPanels } from "@/components/user/funds/UserFundsPlatformPanels";
import { UserFundsPollingSection } from "@/components/user/funds/UserFundsPollingSection";
import { requireUserIdForPage } from "@/server/auth/require-user";
import {
  getUserFundsPlatformSnapshot,
  getUserPlatformPayments,
  getUserRecentRevenueLedgers,
} from "@/server/queries/user-funds-platform";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Funds & balance",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function assertYmd(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function buildFundsQs(opts: {
  tab: "exchange" | "platform";
  payKind: "all" | "subscription";
  pfrom?: string;
  pto?: string;
}): string {
  const p = new URLSearchParams();
  p.set("tab", opts.tab);
  if (opts.pfrom) p.set("pfrom", opts.pfrom);
  if (opts.pto) p.set("pto", opts.pto);
  if (opts.payKind === "subscription") p.set("pay_kind", "subscription");
  return p.toString();
}

export default async function UserFundsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const userId = await requireUserIdForPage("/user/funds");
  const sp = await searchParams;

  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel className="!p-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Funds & balance
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sign in to view wallet balances, exchange movements, and platform
            billing.
          </p>
          <Link
            href="/login?next=%2Fuser%2Ffunds"
            className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  const tabRaw = first(sp.tab);
  const tab: "exchange" | "platform" =
    tabRaw === "exchange" ? "exchange" : "platform";

  const payKind: "all" | "subscription" =
    first(sp.pay_kind) === "subscription" ? "subscription" : "all";

  const pfromRaw = first(sp.pfrom);
  const ptoRaw = first(sp.pto);
  const pfrom = assertYmd(pfromRaw) ? pfromRaw : undefined;
  const pto = assertYmd(ptoRaw) ? ptoRaw : undefined;

  const revPayRaw = first(sp.revPay);
  const revenueReturnNotice =
    typeof revPayRaw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      revPayRaw,
    );

  const [snapshot, payments, ledgers] = await Promise.all([
    getUserFundsPlatformSnapshot(userId),
    getUserPlatformPayments(userId, {
      dateFrom: pfrom,
      dateTo: pto,
      payKind,
    }),
    getUserRecentRevenueLedgers(userId),
  ]);

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Funds & balance
        </h1>
        <GlassPanel className="!p-6">
          <p className="text-[var(--text-muted)]">
            Funds data is unavailable (database not configured or query failed).
          </p>
        </GlassPanel>
      </div>
    );
  }

  const qsPlatform = buildFundsQs({ tab: "platform", payKind, pfrom, pto });
  const qsExchange = buildFundsQs({ tab: "exchange", payKind, pfrom, pto });

  const tabClass = (active: boolean) =>
    `rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? "bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/40"
        : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Funds & balance
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Live Delta wallet (60s refresh), exchange movements, subscriptions,
          and revenue share ledgers.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--border-glass)]/80 bg-black/25 p-1.5 backdrop-blur-sm">
        <Link href={`/user/funds?${qsPlatform}`} className={tabClass(tab === "platform")}>
          Platform billing
        </Link>
        <Link href={`/user/funds?${qsExchange}`} className={tabClass(tab === "exchange")}>
          Exchange movements
        </Link>
      </div>

      <UserFundsPollingSection
        platform={snapshot}
        showExchangeTables={tab === "exchange"}
      />

      {tab === "platform" ? (
        <UserFundsPlatformPanels
          snapshot={snapshot}
          payments={payments}
          ledgers={ledgers}
          revenueReturnNotice={revenueReturnNotice}
          defaultPfrom={pfrom ?? ""}
          defaultPto={pto ?? ""}
          defaultPayKind={payKind}
        />
      ) : null}
    </div>
  );
}
