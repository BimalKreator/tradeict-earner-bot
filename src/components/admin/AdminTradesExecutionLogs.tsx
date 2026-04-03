import type { AdminBotExecutionLogRow } from "@/server/queries/admin-trades-ledger";

export function AdminTradesExecutionLogs({
  logsByOrderId,
}: {
  logsByOrderId: Record<string, AdminBotExecutionLogRow[]>;
}) {
  const entries = Object.entries(logsByOrderId).filter(([, logs]) => logs.length > 0);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No execution logs on this page (shown for bot orders that failed or have retries).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map(([orderId, logs]) => (
        <details
          key={orderId}
          className="rounded-xl border border-[var(--border-glass)] bg-black/20 px-3 py-2"
        >
          <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
            Bot order {orderId.slice(0, 8)}… · {logs.length} log line(s)
          </summary>
          <ul className="mt-2 space-y-2 border-t border-[var(--border-glass)]/40 pt-2">
            {logs.map((log) => (
              <li
                key={log.id}
                className="rounded-lg bg-black/30 p-2 text-[11px] text-[var(--text-muted)]"
              >
                <div className="flex flex-wrap gap-2 text-[var(--text-primary)]">
                  <span className="font-mono text-[10px] text-slate-400">
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "short",
                      timeStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(log.createdAt))}{" "}
                    UTC
                  </span>
                  <span
                    className={
                      log.level === "error"
                        ? "text-red-300"
                        : log.level === "warn"
                          ? "text-amber-300"
                          : "text-slate-300"
                    }
                  >
                    [{log.level}]
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[var(--text-primary)]">
                  {log.message}
                </p>
                {log.rawPayload != null ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-slate-300">
                    {JSON.stringify(log.rawPayload, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
