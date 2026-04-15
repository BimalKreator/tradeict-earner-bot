import Link from "next/link";

import { DeltaApiWhitelistBanner } from "@/components/user/DeltaApiWhitelistBanner";
import { ExchangeConnectionPanel } from "@/components/user/ExchangeConnectionPanel";
import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  deriveExchangeConnectionUiStatus,
  exchangeConnectionUiLabel,
} from "@/lib/exchange-connection-display";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { listUserDeltaIndiaExchangeConnections } from "@/server/queries/user-exchange-connection";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Exchange",
};

const emptyDisplay = {
  id: null,
  status: "active",
  hasStoredCredentials: false,
  lastTestStatus: "unknown",
  lastTestAt: null as Date | null,
  lastTestMessage: null as string | null,
  accountLabel: "",
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

  const rows = await listUserDeltaIndiaExchangeConnections(userId);

  const outboundWhitelistIp = (
    process.env.NEXT_PUBLIC_SERVER_OUTBOUND_IP ?? ""
  ).trim();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Exchange connections
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Delta Exchange India — save multiple API profiles (e.g. two accounts) with
          labels, test each connection, and assign them on strategy settings as primary
          or secondary venues.
        </p>
      </div>

      <DeltaApiWhitelistBanner outboundIp={outboundWhitelistIp} />

      {rows.length === 0 ? (
        <ExchangeConnectionPanel connection={emptyDisplay} />
      ) : (
        <div className="space-y-10">
          <GlassPanel className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Saved Delta accounts
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Choose an account below to edit/test/toggle, or add a new one.
                </p>
              </div>
              <a href="#add-new-exchange-account" className="btn-primary">
                Add New Exchange Account
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map((r) => {
                const derived = deriveExchangeConnectionUiStatus({
                  status: r.status,
                  hasStoredCredentials: r.hasStoredCredentials,
                  lastTestStatus: r.lastTestStatus,
                  lastTestAt: r.lastTestAt,
                  lastTestMessage: r.lastTestMessage,
                });
                return (
                  <div
                    key={`${r.id}-summary`}
                    className="rounded-xl border border-[var(--border-glass)] bg-black/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                          {r.accountLabel}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {exchangeConnectionUiLabel(derived.ui)}
                        </p>
                      </div>
                      <a
                        href={`#exchange-connection-${r.id}`}
                        className="rounded-lg border border-[var(--border-glass)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-white/5"
                      >
                        Edit
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassPanel>

          {rows.map((r) => (
            <ExchangeConnectionPanel
              key={r.id}
              panelId={`exchange-connection-${r.id}`}
              title={`Connection status · ${r.accountLabel}`}
              connection={{
                id: r.id,
                accountLabel: r.accountLabel,
                status: r.status,
                hasStoredCredentials: r.hasStoredCredentials,
                lastTestStatus: r.lastTestStatus,
                lastTestAt: r.lastTestAt,
                lastTestMessage: r.lastTestMessage,
              }}
            />
          ))}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Add another account
            </h2>
            <div id="add-new-exchange-account">
              <ExchangeConnectionPanel connection={emptyDisplay} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
