import { PanelShell } from "@/components/layout/PanelShell";
import { requireAdminSession } from "@/server/auth/require-admin";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/user-strategies", label: "User strategies" },
  { href: "/admin/profile-requests", label: "Profile requests" },
  { href: "/admin/strategies", label: "Strategies" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/terms", label: "Terms" },
  { href: "/admin/audit-logs", label: "Audit logs" },
];

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession();

  return (
    <PanelShell
      title="Tradeict Earner"
      subtitle="Admin panel"
      items={navItems}
    >
      {children}
    </PanelShell>
  );
}
