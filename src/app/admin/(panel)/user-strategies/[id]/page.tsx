import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AdminUserStrategyDetailActions } from "@/components/admin/AdminUserStrategyDetailActions";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount } from "@/lib/format-inr";
import { getAdminUserStrategyDetail } from "@/server/queries/admin-user-strategies";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const d = await getAdminUserStrategyDetail(id);
  return {
    title: d ? `${d.strategyName} · subscription` : "Subscription",
  };
}

const RUN_LABELS: Record<string, string> = {
  active: "Active",
  blocked_revenue_due: "Blocked — revenue due",
  paused_revenue_due: "Paused — revenue due",
  paused_admin: "Paused — admin",
  paused_exchange_off: "Paused — exchange",
  paused_by_user: "Paused — user",
  ready_to_activate: "Ready to activate",
  inactive: "Inactive",
  expired: "Expired",
  paused: "Paused",
};

export default async function AdminUserStrategyDetailPage({ params }: Props) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    notFound();
  }

  const d = await getAdminUserStrategyDetail(id);
  if (!d) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/user-strategies"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          User strategies
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          {d.strategyName}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {d.userEmail}
          {d.userName ? ` · ${d.userName}` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="space-y-2 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Subscription
          </h2>
          <p className="text-[var(--text-primary)]">
            Status:{" "}
            <span className="text-[var(--text-muted)]">{d.subscriptionStatus}</span>
          </p>
          <p className="text-[var(--text-primary)]">
            Access valid until (IST):{" "}
            <span className="text-[var(--text-muted)]">
              {new Intl.DateTimeFormat("en-IN", {
                dateStyle: "full",
                timeStyle: "short",
                timeZone: "Asia/Kolkata",
              }).format(new Date(d.accessValidUntil))}
            </span>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Subscription id:{" "}
            <code className="text-[var(--text-primary)]">{d.subscriptionId}</code>
          </p>
        </GlassPanel>

        <GlassPanel className="space-y-2 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Run and blocks
          </h2>
          <p className="text-[var(--text-primary)]">
            Run status:{" "}
            <span className="font-medium text-[var(--accent)]">
              {RUN_LABELS[d.runStatus] ?? d.runStatus}
            </span>
          </p>
          {d.revenueBlocking ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Revenue block: overdue unpaid or partial weekly ledger past grace.
              Resolve billing before expecting normal trading.
            </p>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              No overdue revenue ledger block detected for this subscription.
            </p>
          )}
          {d.lastStateReason ? (
            <p className="text-xs text-[var(--text-muted)]">
              Last state reason:{" "}
              <code className="text-[var(--text-primary)]">{d.lastStateReason}</code>
            </p>
          ) : null}
        </GlassPanel>
      </div>

      <GlassPanel className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Engine configuration (run row)
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Eligibility uses capital and leverage from user_strategy_runs.
        </p>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p className="text-[var(--text-primary)]">
            Capital (INR):{" "}
            <span className="font-medium tabular-nums">
              {d.capitalToUseInr ? formatInrAmount(d.capitalToUseInr) : "—"}
            </span>
          </p>
          <p className="text-[var(--text-primary)]">
            Leverage:{" "}
            <span className="font-medium tabular-nums">{d.leverage ?? "—"}</span>
          </p>
          <p className="text-xs text-[var(--text-muted)] sm:col-span-2">
            Activated:{" "}
            {d.activatedAt
              ? new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kolkata",
                }).format(d.activatedAt)
              : "—"}{" "}
            · Paused at:{" "}
            {d.pausedAt
              ? new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kolkata",
                }).format(d.pausedAt)
              : "—"}
          </p>
        </div>
      </GlassPanel>

      <GlassPanel className="space-y-2 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Delta India exchange (latest row)
        </h2>
        {d.exchange ? (
          <ul className="space-y-1 text-xs text-[var(--text-muted)]">
            <li>
              Connection status:{" "}
              <span className="text-[var(--text-primary)]">{d.exchange.status}</span>
            </li>
            <li>
              Last test:{" "}
              <span className="text-[var(--text-primary)]">
                {d.exchange.lastTestStatus ?? "—"}
              </span>
              {d.exchange.lastTestAt
                ? ` · ${new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  }).format(d.exchange.lastTestAt)}`
                : null}
            </li>
            <li>
              API keys stored:{" "}
              <span className="text-[var(--text-primary)]">
                {d.exchange.hasKeys ? "yes" : "no"}
              </span>
            </li>
          </ul>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No Delta India row.</p>
        )}
      </GlassPanel>

      <GlassPanel>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Admin actions
        </h2>
        <AdminUserStrategyDetailActions
          subscriptionId={d.subscriptionId}
          runId={d.runId}
          runStatus={d.runStatus}
          userId={d.userId}
        />
      </GlassPanel>
    </div>
  );
}
