import Link from "next/link";

type Props = {
  page: number;
  totalPages: number;
  q: string;
  status: string;
  pageSize: number;
};

function buildHref(p: number, q: string, status: string, pageSize: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  params.set("pageSize", String(pageSize));
  if (p > 1) params.set("page", String(p));
  const qs = params.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

export function AdminUsersPagination({
  page,
  totalPages,
  q,
  status,
  pageSize,
}: Props) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-glass)] pt-4 text-sm text-[var(--text-muted)]">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1, q, status, pageSize)}
            className="rounded-lg border border-[var(--border-glass)] px-3 py-1.5 text-[var(--text-primary)] hover:bg-white/5"
          >
            Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1, q, status, pageSize)}
            className="rounded-lg border border-[var(--border-glass)] px-3 py-1.5 text-[var(--text-primary)] hover:bg-white/5"
          >
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}
