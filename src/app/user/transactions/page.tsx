import { GlassPanel } from "@/components/ui/GlassPanel";

export const metadata = {
  title: "Transactions",
};

export default function UserTransactionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
        Transactions
      </h1>
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Per-trade detail from the bot will render here (Phase 2+).
        </p>
      </GlassPanel>
    </div>
  );
}
