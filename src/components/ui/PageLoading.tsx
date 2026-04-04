import { GlassPanel } from "@/components/ui/GlassPanel";

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <GlassPanel className="flex min-h-[40vh] flex-col items-center justify-center gap-4 !p-10">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--border-glass)] border-t-[var(--accent)]"
        role="status"
        aria-label={label}
      />
      <p className="text-sm text-[var(--text-muted)]">{label}</p>
    </GlassPanel>
  );
}
