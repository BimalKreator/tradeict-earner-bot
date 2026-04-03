import { AdminStrategyForm } from "@/components/admin/AdminStrategyForm";

export const metadata = {
  title: "New strategy",
};

export default function AdminNewStrategyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          New strategy
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Create a strategy users can subscribe to. Slug cannot be changed later.
        </p>
      </div>
      <AdminStrategyForm mode="create" />
    </div>
  );
}
