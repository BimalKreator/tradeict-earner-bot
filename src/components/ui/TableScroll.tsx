import type { ReactNode } from "react";

/**
 * Horizontal scroll region for wide tables: touch momentum, subtle edge cue on small screens.
 */
export function TableScroll({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div
        className="-mx-px overflow-x-auto overscroll-x-contain scroll-smooth px-px [scrollbar-gutter:stable] touch-pan-x"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {children}
      </div>
      <div
        className="pointer-events-none absolute inset-y-1 right-0 z-[1] w-10 bg-gradient-to-l from-[rgba(3,7,18,0.85)] to-transparent md:hidden"
        aria-hidden
      />
    </div>
  );
}
