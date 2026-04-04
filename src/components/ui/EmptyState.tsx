import type { ReactNode } from "react";

/**
 * Polished empty state for tables and panels (no business logic).
 */
export function EmptyState(props: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { title, description, icon, action, className = "" } = props;

  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}
    >
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-glass)] bg-black/35 text-[var(--accent)] backdrop-blur-sm"
        aria-hidden
      >
        {icon ?? (
          <svg
            className="h-7 w-7 opacity-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293L7.293 13.293A1 1 0 006.586 13H4"
            />
          </svg>
        )}
      </div>
      <p className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--text-primary)]">
        {title}
      </p>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
