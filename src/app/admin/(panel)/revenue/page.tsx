import { AdminRevenueBulkReminders } from "@/components/admin/AdminRevenueBulkReminders";
import { AdminRevenueLedgersTable } from "@/components/admin/AdminRevenueLedgersTable";
import { AdminRevenueSummaryCards } from "@/components/admin/AdminRevenueSummaryCards";
import { AdminRevenueToolbar } from "@/components/admin/AdminRevenueToolbar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { addCalendarDaysYmd, calendarDateIST } from "@/server/cron/ist-calendar";
import { db } from "@/server/db";
import {
  getAdminRevenueLedgerRows,
  getAdminRevenueSummary,
  type AdminRevenueFilters,
} from "@/server/queries/admin-revenue";

export const metadata = {
  title: "Revenue & billing",
};

export const dynamic = "force-dynamic";

function istWeekStartForLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const delta = wd === 0 ? -6 : 1 - wd;
  return addCalendarDaysYmd(ymd, delta);
}

function recentIstWeekStarts(n: number): string[] {
  const today = calendarDateIST();
  let mon = istWeekStartForLabel(today);
  const list: string[] = [];
  for (let i = 0; i < n; i++) {
    list.push(mon);
    mon = addCalendarDaysYmd(mon, -7);
  }
  return list;
}

function parseWeek(raw: string | undefined): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [y, m, d] = raw.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd !== 1) return "";
  return raw;
}

function parseBilling(raw: string | undefined): "all" | "blocked" | "clean" {
  if (raw === "blocked" || raw === "clean") return raw;
  return "all";
}

function parseSort(
  raw: string | undefined,
): "week" | "user" | "outstanding" | "status" {
  if (raw === "user" || raw === "outstanding" || raw === "status") return raw;
  return "week";
}

function parseDir(raw: string | undefined): "asc" | "desc" {
  return raw === "asc" ? "asc" : "desc";
}

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminRevenuePage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const week = parseWeek(typeof sp.week === "string" ? sp.week : undefined);
  const billing = parseBilling(
    typeof sp.billing === "string" ? sp.billing : undefined,
  );
  const sort = parseSort(typeof sp.sort === "string" ? sp.sort : undefined);
  const dir = parseDir(typeof sp.dir === "string" ? sp.dir : undefined);

  const filters: AdminRevenueFilters = {
    weekStartIst: week || undefined,
    userEmailQuery: q || undefined,
    billingStatus: billing,
    sort,
    dir,
  };

  const summary =
    db != null ? await getAdminRevenueSummary(filters) : null;
  const rows =
    db != null ? await getAdminRevenueLedgerRows(filters, 400) : [];

  const weekOptions = recentIstWeekStarts(26);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Revenue & billing
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Platform-wide revenue ledgers, Cashfree collections, waivers, and
          reminders. Filter by IST billing week (Monday start). All actions are
          audited as admin.
        </p>
      </div>

      {summary ? (
        <AdminRevenueSummaryCards summary={summary} />
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Database not configured — metrics unavailable.
        </p>
      )}

      <GlassPanel>
        <AdminRevenueToolbar
          week={week}
          q={q}
          billing={billing}
          sort={sort}
          dir={dir}
          weekOptions={weekOptions}
        />
        <div className="mt-6">
          <AdminRevenueLedgersTable rows={rows} />
        </div>
        <AdminRevenueBulkReminders />
      </GlassPanel>
    </div>
  );
}
