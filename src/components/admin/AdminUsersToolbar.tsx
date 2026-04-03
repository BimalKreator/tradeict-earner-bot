type Props = {
  initialQ: string;
  status: string;
  pageSize: number;
};

export function AdminUsersToolbar({ initialQ, status, pageSize }: Props) {
  return (
    <form
      method="get"
      action="/admin/users"
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="min-w-[200px] flex-1">
        <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Search
        </label>
        <input
          name="q"
          type="search"
          defaultValue={initialQ}
          placeholder="Email or name"
          className="mt-1 w-full rounded-xl border border-[var(--border-glass)] bg-black/25 px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        />
      </div>
      {status !== "all" ? (
        <input type="hidden" name="status" value={status} />
      ) : null}
      <input type="hidden" name="pageSize" value={String(pageSize)} />
      <button
        type="submit"
        className="rounded-xl bg-[var(--accent-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--bg-void)] hover:brightness-110"
      >
        Search
      </button>
    </form>
  );
}
