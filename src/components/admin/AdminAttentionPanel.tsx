import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import type {
  AdminAttentionProfileRow,
  AdminAttentionRunRow,
  AdminAttentionUserRow,
} from "@/server/queries/admin-dashboard";

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-[var(--border-glass)]/40 bg-black/20 px-3 py-2 text-sm text-[var(--text-muted)]">
      {text}
    </p>
  );
}

export function AdminAttentionPanel({
  runs,
  pendingUsers,
  profileRequests,
}: {
  runs: AdminAttentionRunRow[];
  pendingUsers: AdminAttentionUserRow[];
  profileRequests: AdminAttentionProfileRow[];
}) {
  const hasAnything =
    runs.length > 0 || pendingUsers.length > 0 || profileRequests.length > 0;

  return (
    <GlassPanel className="!p-0 overflow-hidden">
      <div className="border-b border-[var(--border-glass)] px-6 py-4">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
          Action required
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Paused runs (exchange / admin /{" "}
          <span className="text-red-300/90">revenue block</span>), pending user
          approvals, and profile change requests.
        </p>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            Runs — attention
          </h3>
          {runs.length === 0 ? (
            <EmptyRow text="No runs in blocked / paused-admin / exchange-off states." />
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li
                  key={r.runId}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    r.status === "blocked_revenue_due"
                      ? "border-red-500/40 bg-red-950/25 ring-1 ring-red-500/20"
                      : "border-[var(--border-glass)]/50 bg-black/25"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/admin/users/${r.userId}`}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      {r.userEmail}
                    </Link>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        r.status === "blocked_revenue_due"
                          ? "bg-red-500/20 text-red-100"
                          : "bg-amber-500/15 text-amber-200"
                      }`}
                    >
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {r.strategyName}
                    {r.lastStateReason ? ` · ${r.lastStateReason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            User approvals
          </h3>
          {pendingUsers.length === 0 ? (
            <EmptyRow text="No users waiting for profile approval." />
          ) : (
            <ul className="space-y-2">
              {pendingUsers.map((u) => (
                <li
                  key={u.userId}
                  className="rounded-xl border border-[var(--border-glass)]/50 bg-black/25 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/users/${u.userId}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {u.email}
                  </Link>
                  {u.name ? (
                    <p className="text-xs text-[var(--text-muted)]">{u.name}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            Profile requests
          </h3>
          {profileRequests.length === 0 ? (
            <EmptyRow text="No pending profile change requests." />
          ) : (
            <ul className="space-y-2">
              {profileRequests.map((p) => (
                <li
                  key={p.requestId}
                  className="rounded-xl border border-[var(--border-glass)]/50 bg-black/25 px-3 py-2 text-sm"
                >
                  <Link
                    href="/admin/profile-requests"
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {p.email}
                  </Link>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Request · user{" "}
                    <Link
                      href={`/admin/users/${p.userId}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      open
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!hasAnything ? (
        <p className="border-t border-[var(--border-glass)]/40 px-6 py-3 text-center text-xs text-emerald-300/90">
          All clear — nothing queued for admin action in these categories.
        </p>
      ) : null}
    </GlassPanel>
  );
}
