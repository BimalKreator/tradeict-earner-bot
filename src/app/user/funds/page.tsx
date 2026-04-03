import { GlassPanel } from "@/components/ui/GlassPanel";

export const metadata = {
  title: "Funds",
};

export default function UserFundsPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
        Funds
      </h1>
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Exchange balance, fund movement, and revenue share dues — upcoming.
        </p>
      </GlassPanel>
    </div>
  );
}
