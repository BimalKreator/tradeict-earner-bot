"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { LogoutButton } from "@/components/auth/LogoutButton";

export type PanelNavItem = { href: string; label: string };

type PanelShellProps = {
  /** Shown in sidebar header */
  title: string;
  /** Subtitle under title (e.g. "User panel") */
  subtitle: string;
  items: PanelNavItem[];
  children: ReactNode;
};

/**
 * Responsive shell: fixed glass sidebar on desktop, slide-over on mobile.
 * Shared by /user/* and /admin/* layouts.
 */
export function PanelShell({
  title,
  subtitle,
  items,
  children,
}: PanelShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1 p-4">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`rounded-xl px-3 py-3 text-sm font-medium transition-colors min-h-11 flex items-center ${
              active
                ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* Mobile overlay */}
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="panel-sidebar-nav"
        className={`glass-sidebar fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-width)] -translate-x-full flex-col transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : ""
        }`}
      >
        <div className="border-b border-[var(--border-glass)] p-4">
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
            {title}
          </p>
          <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
        </div>
        {nav}
        <div className="mt-auto space-y-3 border-t border-[var(--border-glass)] p-4">
          <LogoutButton />
          <Link
            href="/"
            className="block text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            ← Public site
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col md:pl-0">
        <header className="flex min-h-14 items-center gap-3 border-b border-[var(--border-glass)] bg-[rgba(3,7,18,0.55)] px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(3,7,18,0.4)] md:hidden">
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-glass)] bg-black/30 text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(56,189,248,0.06)] backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="panel-sidebar-nav"
            aria-label="Open navigation menu"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <span className="min-w-0 truncate font-medium text-[var(--text-primary)]">
            {subtitle}
          </span>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
