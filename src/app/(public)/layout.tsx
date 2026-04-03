import { PublicHeader } from "@/components/layout/PublicHeader";

/**
 * Public / marketing segment: top navigation + full-width content.
 * Authenticated panels live under /user and /admin with their own layouts.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <PublicHeader />
      <div className="flex-1">{children}</div>
    </div>
  );
}
