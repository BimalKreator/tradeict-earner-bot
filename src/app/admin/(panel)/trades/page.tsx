import { AdminTradesExecutionLogs } from "@/components/admin/AdminTradesExecutionLogs";
import { AdminTradesSummaryStrip } from "@/components/admin/AdminTradesSummaryStrip";
import { AdminTradesTable } from "@/components/admin/AdminTradesTable";
import { AdminTradesToolbar } from "@/components/admin/AdminTradesToolbar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { listStrategiesForAdmin } from "@/server/queries/admin-strategies";
import {
  getAdminTradesLedger,
  listBotExecutionLogsForOrderIds,
  type AdminBotExecutionLogRow,
  type AdminTradeLedgerFilters,
} from "@/server/queries/admin-trades-ledger";

export const metadata = {
  title: "Trade monitoring",
};

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function parseYmd(raw: string | undefined): string | undefined {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return undefined;
}

function parsePnl(
  raw: string | undefined,
): AdminTradeLedgerFilters["pnl"] {
  if (raw === "profit" || raw === "loss") return raw;
  return "any";
}

function parseExec(
  raw: string | undefined,
): AdminTradeLedgerFilters["execOutcome"] {
  if (raw === "success" || raw === "failure") return raw;
  return "any";
}

function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export default async function AdminTradesPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};

  const filters: AdminTradeLedgerFilters = {
    dateFromIst: parseYmd(pick(sp, "dateFrom")),
    dateToIst: parseYmd(pick(sp, "dateTo")),
    userQ: pick(sp, "q"),
    strategyId: pick(sp, "strategyId"),
    pnl: parsePnl(pick(sp, "pnl")),
    execOutcome: parseExec(pick(sp, "exec")),
    page: parsePage(pick(sp, "page")),
  };

  const [strategies, ledger] = await Promise.all([
    listStrategiesForAdmin(),
    getAdminTradesLedger(filters),
  ]);

  if (!ledger) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        Database is not configured or unavailable.
      </div>
    );
  }

  const orderIds = [
    ...new Set(
      ledger.rows
        .filter(
          (r) =>
            r.ledgerKind === "bot_order" &&
            r.botOrderId != null &&
            (r.execFailed || r.retryCount > 0),
        )
        .map((r) => r.botOrderId as string),
    ),
  ];

  const logsFlat = await listBotExecutionLogsForOrderIds(orderIds);

  const logsByOrderId: Record<string, AdminBotExecutionLogRow[]> = {};
  for (const id of orderIds) {
    logsByOrderId[id] = [];
  }
  for (const log of logsFlat) {
    if (!logsByOrderId[log.botOrderId]) {
      logsByOrderId[log.botOrderId] = [];
    }
    logsByOrderId[log.botOrderId].push(log);
  }
  for (const k of Object.keys(logsByOrderId)) {
    logsByOrderId[k].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  const totalPages = Math.max(1, Math.ceil(ledger.total / ledger.pageSize));

  const toolbarValues = {
    dateFrom: filters.dateFromIst ?? "",
    dateTo: filters.dateToIst ?? "",
    userQ: filters.userQ ?? "",
    strategyId: filters.strategyId ?? "",
    pnl: filters.pnl,
    execOutcome: filters.execOutcome,
    page: ledger.page,
    pageSize: ledger.pageSize,
    totalPages,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--text-primary)]">
          Trade monitoring
        </h1>
        <p className="max-w-2xl text-sm text-[var(--text-muted)]">
          Global ledger of bot orders and manual trades. Filters use IST calendar
          dates; summaries match the current filter (not only this page).
        </p>
      </header>

      <AdminTradesSummaryStrip summary={ledger.summary} />

      <GlassPanel className="space-y-4">
        <AdminTradesToolbar strategies={strategies} values={toolbarValues} />
        <AdminTradesTable rows={ledger.rows} />
      </GlassPanel>

      <GlassPanel className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Execution diagnostics
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Logs for bot orders on this page that failed or have retries (
          <code className="text-[var(--accent)]">bot_execution_logs</code>
          ).
        </p>
        <AdminTradesExecutionLogs logsByOrderId={logsByOrderId} />
      </GlassPanel>
    </div>
  );
}
