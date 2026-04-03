import { desc, eq } from "drizzle-orm";

import { AdminRevenueLedgersTable } from "@/components/admin/AdminRevenueLedgersTable";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { db } from "@/server/db";
import {
  strategies,
  users,
  weeklyRevenueShareLedgers,
} from "@/server/db/schema";

export const metadata = {
  title: "Revenue",
};

export const dynamic = "force-dynamic";

export default async function AdminRevenuePage() {
  const rows =
    db != null
      ? await db
          .select({
            id: weeklyRevenueShareLedgers.id,
            userEmail: users.email,
            strategyName: strategies.name,
            weekStartDateIst: weeklyRevenueShareLedgers.weekStartDateIst,
            weekEndDateIst: weeklyRevenueShareLedgers.weekEndDateIst,
            amountDueInr: weeklyRevenueShareLedgers.amountDueInr,
            amountPaidInr: weeklyRevenueShareLedgers.amountPaidInr,
            status: weeklyRevenueShareLedgers.status,
          })
          .from(weeklyRevenueShareLedgers)
          .innerJoin(users, eq(users.id, weeklyRevenueShareLedgers.userId))
          .innerJoin(
            strategies,
            eq(strategies.id, weeklyRevenueShareLedgers.strategyId),
          )
          .orderBy(desc(weeklyRevenueShareLedgers.weekStartDateIst))
          .limit(100)
      : [];

  const mapped = rows.map((r) => ({
    id: r.id,
    userEmail: r.userEmail,
    strategyName: r.strategyName,
    weekStartDateIst: String(r.weekStartDateIst),
    weekEndDateIst: String(r.weekEndDateIst),
    amountDueInr: String(r.amountDueInr),
    amountPaidInr: String(r.amountPaidInr),
    status: r.status,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Revenue
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Weekly revenue share ledger rows (IST week boundaries). Latest 100
          entries. Reminders, payment links, and waivers come in Phase 6+.
        </p>
      </div>
      <GlassPanel>
        <AdminRevenueLedgersTable rows={mapped} />
      </GlassPanel>
    </div>
  );
}
