import { PanelShell } from "@/components/layout/PanelShell";

const navItems = [
  { href: "/user/dashboard", label: "Dashboard" },
  { href: "/user/reports", label: "Reports" },
  { href: "/user/strategies", label: "Strategies" },
  { href: "/user/my-strategies", label: "My strategies" },
  { href: "/user/transactions", label: "Transactions" },
  { href: "/user/funds", label: "Funds" },
  { href: "/user/exchange", label: "Exchange" },
  { href: "/user/profile", label: "Profile" },
];

/**
 * Authenticated user panel — sidebar + content region.
 * Middleware enforces session (or bypass) on all /user/* paths.
 */
export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PanelShell
      title="Tradeict Earner"
      subtitle="User panel"
      items={navItems}
    >
      {children}
    </PanelShell>
  );
}
