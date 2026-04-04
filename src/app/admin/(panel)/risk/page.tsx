import Link from "next/link";

import { AdminRiskEmergencyForm } from "@/components/admin/AdminRiskEmergencyForm";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { requireAdminId } from "@/server/auth/require-admin-id";
import { getAdminRiskPageData } from "@/server/queries/admin-risk";

async function optionalAdminId(): Promise<string | null> {
  if (process.env.AUTH_PHASE1_BYPASS === "true") {
    return null;
  }
  try {
    return await requireAdminId();
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Risk command center",
};

export const dynamic = "force-dynamic";

function fmtIst(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export default async function AdminRiskPage() {
  const adminId = await optionalAdminId();
  const data = await getAdminRiskPageData(adminId);

  if (!data) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Database is not configured or unavailable.
        </p>
      </GlassPanel>
    );
  }

  const canToggle = data.viewerRole === "super_admin";
  const emergencyActive = data.emergency.active === true;
  const updatedHint =
    typeof data.emergency.updatedAt === "string"
      ? `Last change: ${data.emergency.updatedAt} (UTC)`
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Risk command center
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Global kill switch, execution safety hierarchy, and runs paused for
          margin or exchange connectivity — use this to coordinate user outreach.
        </p>
      </div>

      <GlassPanel className="border border-white/[0.08]">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Global emergency stop
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          When engaged, the execution worker rejects{" "}
          <strong className="text-[var(--text-primary)]">all</strong> new order
          submissions, including close-position (exit) signals. Open positions are
          not auto-closed; they remain on the exchange until trading resumes or
          the user acts manually.
        </p>
        {updatedHint ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{updatedHint}</p>
        ) : null}
        <div className="mt-4">
          <AdminRiskEmergencyForm
            initialActive={emergencyActive}
            canToggle={canToggle}
          />
        </div>
      </GlassPanel>

      <GlassPanel>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Runs paused — funds or exchange
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          <code className="text-[var(--accent)]">paused_insufficient_funds</code>{" "}
          is set automatically when Delta returns insufficient margin/balance on
          order placement. <code className="text-[var(--accent)]">paused_exchange_off</code>{" "}
          usually means keys, test, or connection state needs attention.
        </p>

        {data.attentionRuns.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            No runs in these states right now.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="pb-2 pr-2 font-medium">Paused (IST)</th>
                  <th className="pb-2 pr-2 font-medium">User</th>
                  <th className="pb-2 pr-2 font-medium">Strategy</th>
                  <th className="pb-2 pr-2 font-medium">Status</th>
                  <th className="pb-2 pr-2 font-medium">Reason</th>
                  <th className="pb-2 font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {data.attentionRuns.map((r) => (
                  <tr
                    key={r.runId}
                    className="border-b border-[var(--border-glass)]/50 text-[var(--text-primary)]"
                  >
                    <td className="py-2 pr-2 align-top text-[var(--text-muted)]">
                      {fmtIst(r.pausedAt)}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <div className="font-medium">{r.userEmail}</div>
                      {r.userName ? (
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {r.userName}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 align-top">{r.strategyName}</td>
                    <td className="py-2 pr-2 align-top font-mono text-[10px] text-[var(--accent)]">
                      {r.runStatus}
                    </td>
                    <td className="max-w-[280px] py-2 pr-2 align-top text-[10px] text-[var(--text-muted)]">
                      {r.lastStateReason ?? "—"}
                    </td>
                    <td className="py-2 align-top">
                      <Link
                        href={`/admin/user-strategies/${r.subscriptionId}`}
                        className="text-[var(--accent)] underline decoration-blue-500/40 underline-offset-2"
                      >
                        Subscription
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
