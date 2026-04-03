import type { UserDashboardData } from "@/lib/user-dashboard-types";

const styles: Record<
  UserDashboardData["exchange"]["label"],
  string
> = {
  Connected:
    "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  Invalid: "border-[var(--danger)]/40 bg-red-500/10 text-red-300",
  Disabled: "border-white/10 bg-black/30 text-[var(--text-muted)]",
  "Needs attention":
    "border-amber-500/35 bg-amber-500/10 text-amber-200",
  "Not linked": "border-[var(--border-glass)] bg-black/25 text-[var(--text-muted)]",
};

export function ExchangeStatusBadge({
  exchange,
}: {
  exchange: UserDashboardData["exchange"];
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Delta India
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {exchange.connectionStatus && exchange.lastTestStatus
            ? `Connection: ${exchange.connectionStatus} · Last test: ${exchange.lastTestStatus}`
            : "No active connection on file."}
        </p>
      </div>
      <span
        className={`inline-flex w-fit shrink-0 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${styles[exchange.label]}`}
      >
        {exchange.label}
      </span>
    </div>
  );
}
