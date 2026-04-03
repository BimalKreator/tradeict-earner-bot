import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminUserEditForm } from "@/components/admin/AdminUserEditForm";
import { AdminUserInternalNotesForm } from "@/components/admin/AdminUserInternalNotesForm";
import { AdminUserLifecycleActions } from "@/components/admin/AdminUserLifecycleActions";
import { AdminUserStrategyForcePauseForm } from "@/components/admin/AdminUserStrategyForcePauseForm";
import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  deriveExchangeConnectionUiStatus,
  exchangeConnectionUiLabel,
} from "@/lib/exchange-connection-display";
import { formatInrAmount } from "@/lib/format-inr";
import { adminCanForcePauseRunStatus } from "@/lib/admin-strategy-run";
import { getAdminUserProfile } from "@/server/queries/admin-user-detail";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ email_delivery?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const profile = await getAdminUserProfile(id);
  return {
    title: profile ? profile.user.email : "User",
  };
}

export default async function AdminUserDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const emailFailed = sp.email_delivery === "failed";
  const profile = await getAdminUserProfile(id);
  if (!profile) {
    notFound();
  }

  const { user } = profile;
  const status = user.approvalStatus as
    | "pending_approval"
    | "approved"
    | "rejected"
    | "paused"
    | "archived";

  return (
    <div className="space-y-6">
      {emailFailed ? (
        <GlassPanel className="border-amber-500/40 bg-amber-500/10">
          <p className="text-sm text-amber-100">
            <strong className="font-medium">Email not delivered.</strong> The account
            was created, but SMTP rejected or is not configured. Check{" "}
            <code className="text-xs">SMTP_HOST</code>,{" "}
            <code className="text-xs">SMTP_USER</code>,{" "}
            <code className="text-xs">SMTP_PASS</code> in{" "}
            <code className="text-xs">.env</code> and{" "}
            <code className="text-xs">email_logs</code>. Send the user a password reset
            or share credentials through a secure channel.
          </p>
        </GlassPanel>
      ) : null}
      <div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/users"
            className="text-sm text-[var(--accent)] hover:underline"
          >
            ← Users
          </Link>
          <Link
            href={`/admin/users/${user.id}/pricing`}
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Pricing overrides
          </Link>
        </div>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          {user.email}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Profile &amp; lifecycle ·{" "}
          <span className="text-[var(--text-primary)]">
            {STATUS_LABELS[user.approvalStatus] ?? user.approvalStatus}
          </span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassPanel className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Basic details
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Email cannot be changed here; users may request email changes from
            their profile (admin approves under Profile requests).
          </p>
          <div className="space-y-1 text-sm text-[var(--text-muted)]">
            <p>
              <span className="text-[var(--text-primary)]">Address:</span>{" "}
              {user.address ?? "—"}
            </p>
            <p>
              <span className="text-[var(--text-primary)]">WhatsApp:</span>{" "}
              {user.whatsappNumber ?? "—"}
            </p>
          </div>
          <AdminUserEditForm
            userId={user.id}
            defaultName={user.name ?? ""}
            defaultPhone={user.phone ?? ""}
          />
        </GlassPanel>

        <GlassPanel className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Lifecycle
          </h2>
          <AdminUserLifecycleActions userId={user.id} status={status} />
        </GlassPanel>
      </div>

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Exchange connection
        </h2>
        {profile.exchangeConnections.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No active connection row. User has not connected Delta India keys, or
            the row was removed.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {profile.exchangeConnections.map((c) => {
              const { ui, detail } = deriveExchangeConnectionUiStatus({
                status: c.status,
                hasStoredCredentials: c.hasStoredCredentials,
                lastTestStatus: c.lastTestStatus,
                lastTestAt: c.lastTestAt,
                lastTestMessage: c.lastTestMessage,
              });
              return (
                <li
                  key={c.id}
                  className="rounded-xl border border-[var(--border-glass)] bg-black/20 p-3"
                >
                  <p className="font-medium capitalize text-[var(--text-primary)]">
                    {c.provider.replace(/_/g, " ")}
                  </p>
                  <p className="text-[var(--text-muted)]">
                    <span className="text-[var(--text-primary)]">
                      {exchangeConnectionUiLabel(ui)}
                    </span>
                    <span className="mx-1 text-slate-600">·</span>
                    Row status: {c.status} · Last test enum: {c.lastTestStatus}
                  </p>
                  {(detail ?? c.lastTestMessage) ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {detail ?? c.lastTestMessage}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          <strong>Balance snapshot:</strong> Not available until live exchange
          balance sync is implemented. Connection test status is shown above.
        </p>
      </GlassPanel>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassPanel className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Active strategies
          </h2>
          {profile.activeStrategies.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">None</p>
          ) : (
            <ul className="space-y-2 text-sm text-[var(--text-primary)]">
              {profile.activeStrategies.map((s) => (
                <li
                  key={s.subscriptionId}
                  className="border-b border-[var(--border-glass)]/40 pb-3"
                >
                  <span className="font-medium">{s.strategyName}</span>
                  {s.hasCustomPricing ? (
                    <span className="ml-2 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                      Custom pricing
                    </span>
                  ) : null}
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    run: {s.runStatus ?? "—"} · valid until{" "}
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeZone: "Asia/Kolkata",
                    }).format(new Date(s.accessValidUntil))}
                  </span>
                  {s.runId && adminCanForcePauseRunStatus(s.runStatus) ? (
                    <AdminUserStrategyForcePauseForm
                      runId={s.runId}
                      strategyName={s.strategyName}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
        <GlassPanel className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Inactive / other subscriptions
          </h2>
          {profile.inactiveStrategies.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">None</p>
          ) : (
            <ul className="space-y-2 text-sm text-[var(--text-primary)]">
              {profile.inactiveStrategies.map((s) => (
                <li
                  key={s.subscriptionId}
                  className="border-b border-[var(--border-glass)]/40 pb-3"
                >
                  <span className="font-medium">{s.strategyName}</span>
                  {s.hasCustomPricing ? (
                    <span className="ml-2 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                      Custom pricing
                    </span>
                  ) : null}
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    sub: {s.subscriptionStatus} · run: {s.runStatus ?? "—"}
                  </span>
                  {s.runId && adminCanForcePauseRunStatus(s.runStatus) ? (
                    <AdminUserStrategyForcePauseForm
                      runId={s.runId}
                      strategyName={s.strategyName}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassPanel className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Revenue &amp; payments
          </h2>
          <p className="text-sm text-[var(--text-primary)]">
            Current revenue-share due:{" "}
            <strong>{formatInrAmount(profile.revenueDueInr)}</strong>
          </p>
          <p className="text-sm text-[var(--text-primary)]">
            Total successful payments:{" "}
            <strong>{formatInrAmount(profile.paymentsSuccessTotalInr)}</strong>
          </p>
        </GlassPanel>
        <GlassPanel className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Pricing overrides
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Manage fixed fees and revenue-share % per strategy, with effective
            windows and audit history.
          </p>
          <Link
            href={`/admin/users/${user.id}/pricing`}
            className="inline-flex rounded-xl border border-[var(--border-glass)] px-4 py-2 text-sm font-medium text-[var(--accent)] hover:bg-white/5"
          >
            Open pricing manager
          </Link>
        </GlassPanel>
      </div>

      {user.approvalNotes ? (
        <GlassPanel>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            User-facing approval note
          </h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{user.approvalNotes}</p>
        </GlassPanel>
      ) : null}

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Internal remarks
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Visible only to staff. Saved changes are written to audit logs.
        </p>
        <AdminUserInternalNotesForm
          userId={user.id}
          defaultNotes={user.adminInternalNotes ?? ""}
        />
      </GlassPanel>
    </div>
  );
}
