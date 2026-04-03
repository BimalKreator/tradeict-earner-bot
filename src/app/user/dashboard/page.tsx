import { GlassPanel } from "@/components/ui/GlassPanel";

export const metadata = {
  title: "Dashboard",
};

/**
 * Dashboard shell: PnL, today profit, transactions, revenue dues — data wiring comes later.
 */
export default function UserDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Bot PnL, today&apos;s profit, and revenue sharing will appear here.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["Total PnL", "Today", "Revenue due"].map((label) => (
          <GlassPanel key={label} className="!p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {label}
            </p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--text-primary)]">
              —
            </p>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
