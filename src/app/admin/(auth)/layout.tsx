import { PublicHeader } from "@/components/layout/PublicHeader";

/**
 * Same shell as public routes: glass header + content area (matches /login chrome).
 */
export default function AdminAuthLayout({
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
