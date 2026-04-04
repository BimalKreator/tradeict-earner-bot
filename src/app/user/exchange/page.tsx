import Link from "next/link";

import { DeltaApiWhitelistBanner } from "@/components/user/DeltaApiWhitelistBanner";
import { ExchangeConnectionPanel } from "@/components/user/ExchangeConnectionPanel";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { getUserDeltaIndiaConnection } from "@/server/queries/user-exchange-connection";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Exchange",
};

export default async function UserExchangePage() {
  const userId = await requireUserIdForPage("/user/exchange");

  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Exchange connection
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sign in to connect Delta Exchange India.
          </p>
          <Link
            href="/login?next=%2Fuser%2Fexchange"
            className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  if (!db) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Database is not configured.
        </p>
      </GlassPanel>
    );
  }

  const row = await getUserDeltaIndiaConnection(userId);

  const outboundWhitelistIp = (
    process.env.NEXT_PUBLIC_SERVER_OUTBOUND_IP ?? ""
  ).trim();

  const connection = row
    ? {
        id: row.id,
        status: row.status,
        hasStoredCredentials: row.hasStoredCredentials,
        lastTestStatus: row.lastTestStatus,
        lastTestAt: row.lastTestAt,
        lastTestMessage: row.lastTestMessage,
      }
    : {
        id: null,
        status: "active",
        hasStoredCredentials: false,
        lastTestStatus: "unknown",
        lastTestAt: null,
        lastTestMessage: null,
      };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Exchange connection
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Delta Exchange India — API keys, connection test, and on/off for future
          automation.
        </p>
      </div>

      <DeltaApiWhitelistBanner outboundIp={outboundWhitelistIp} />

      <ExchangeConnectionPanel connection={connection} />
    </div>
  );
}
