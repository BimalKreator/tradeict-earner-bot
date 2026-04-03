import Link from "next/link";

export const USER_LIST_FILTER_STATUSES = [
  "all",
  "pending_approval",
  "approved",
  "rejected",
  "paused",
  "archived",
] as const;

export type UserListFilterStatus = (typeof USER_LIST_FILTER_STATUSES)[number];

const FILTER_LABELS: Record<UserListFilterStatus, string> = {
  all: "All",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived",
};

function statusHref(
  key: UserListFilterStatus,
  q: string,
  pageSize: number,
): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (key !== "all") params.set("status", key);
  params.set("pageSize", String(pageSize));
  const qs = params.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

export function UserStatusFilter({
  current,
  q = "",
  pageSize = 20,
}: {
  current: UserListFilterStatus;
  q?: string;
  pageSize?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {USER_LIST_FILTER_STATUSES.map((key) => {
        const href = statusHref(key, q, pageSize);
        const active = current === key;
        return (
          <Link
            key={key}
            href={href}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                : "border border-[var(--border-glass)] text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]"
            }`}
          >
            {FILTER_LABELS[key]}
          </Link>
        );
      })}
    </div>
  );
}
