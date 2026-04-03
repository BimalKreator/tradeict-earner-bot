import Link from "next/link";

/**
 * Top navigation for public (marketing) routes — extend with product links as the site grows.
 */
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-glass)] bg-[rgba(3,7,18,0.75)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-[var(--text-primary)]"
        >
          Tradeict <span className="text-[var(--accent)]">Earner</span>
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-1 text-sm text-[var(--text-muted)] sm:gap-2">
          <Link
            href="/terms"
            className="rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--accent-dim)] hover:text-[var(--text-primary)]"
          >
            Terms
          </Link>
          <Link
            href="/contact"
            className="rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--accent-dim)] hover:text-[var(--text-primary)]"
          >
            Contact
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--accent-dim)] hover:text-[var(--text-primary)]"
          >
            Login
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-[var(--accent-dim)] px-3 py-1.5 font-medium text-[var(--accent)] transition-colors hover:bg-[rgba(56,189,248,0.22)]"
          >
            Register
          </Link>
        </nav>
      </div>
    </header>
  );
}
