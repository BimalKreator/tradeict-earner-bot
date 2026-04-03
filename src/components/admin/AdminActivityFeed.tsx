import { GlassPanel } from "@/components/ui/GlassPanel";
import type { AdminActivityItem } from "@/server/queries/admin-dashboard";

const kindStyles: Record<
  AdminActivityItem["kind"],
  string
> = {
  audit: "border-sky-500/25 bg-sky-500/5 text-sky-200/90",
  payment: "border-emerald-500/25 bg-emerald-500/5 text-emerald-200/90",
  bot_error: "border-red-500/30 bg-red-500/10 text-red-200/90",
};

export function AdminActivityFeed({ items }: { items: AdminActivityItem[] }) {
  return (
    <GlassPanel className="!p-0 overflow-hidden">
      <div className="border-b border-[var(--border-glass)] px-6 py-4">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
          Recent platform activity
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Latest audit events, successful payments, and bot error logs (merged,
          newest first).
        </p>
      </div>
      <ul className="divide-y divide-[var(--border-glass)]/40">
        {items.length === 0 ? (
          <li className="px-6 py-8 text-center text-sm text-[var(--text-muted)]">
            No activity rows yet.
          </li>
        ) : (
          items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <span
                  className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${kindStyles[item.kind]}`}
                >
                  {item.kind.replaceAll("_", " ")}
                </span>
                <p className="mt-1.5 font-medium text-[var(--text-primary)]">
                  {item.title}
                </p>
                <p className="text-sm text-[var(--text-muted)]">{item.detail}</p>
              </div>
              <time
                className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]"
                dateTime={item.at}
              >
                {new Date(item.at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                IST
              </time>
            </li>
          ))
        )}
      </ul>
    </GlassPanel>
  );
}
