import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";

export default function NotFound() {
  return (
    <div className="relative z-10 mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-24">
      <GlassPanel className="w-full text-center">
        <p className="text-sm font-medium text-[var(--accent)]">404</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          The page you requested does not exist or was moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-[var(--accent-dim)] px-4 py-2 text-sm font-medium text-[var(--accent)]"
        >
          Back home
        </Link>
      </GlassPanel>
    </div>
  );
}
