import { desc, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/server/db";
import { botExecutionLogs } from "@/server/db/schema";

const PAGE_SIZE_DEFAULT = 40;
const PAGE_SIZE_MAX = 100;

export type AdminTradeLedgerRow = {
  ledgerKind: "bot_order" | "trade";
  ledgerId: string;
  botOrderId: string | null;
  userEmail: string;
  userName: string | null;
  strategyName: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  entryPrice: string | null;
  exitPrice: string | null;
  netPnlInr: string | null;
  revenueShareFeeInr: string;
  venueOrderId: string | null;
  /** Normalized badge key for UI */
  statusBadge:
    | "filled"
    | "partial_fill"
    | "open"
    | "cancelled"
    | "failed";
  execFailed: boolean;
  retryCount: number;
  sourceTag: "bot" | "manual";
  sortTs: string;
};

export type AdminTradeLedgerSummary = {
  totalNetPnlInr: string;
  totalRevenueShareInr: string;
  executionSuccessRatePct: string;
};

export type AdminTradeLedgerResult = {
  rows: AdminTradeLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: AdminTradeLedgerSummary;
};

export type AdminTradeLedgerFilters = {
  dateFromIst?: string;
  dateToIst?: string;
  userQ?: string;
  strategyId?: string;
  pnl: "any" | "profit" | "loss";
  execOutcome: "any" | "success" | "failure";
  page: number;
};

export type AdminBotExecutionLogRow = {
  id: string;
  botOrderId: string;
  level: string;
  message: string;
  rawPayload: Record<string, unknown> | null;
  createdAt: string;
};

function assertYmd(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function assertUuid(s: string | undefined): s is string {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function mapLedgerRow(r: Record<string, unknown>): AdminTradeLedgerRow {
  const g = (k: string) => r[k];
  const kind = g("ledger_kind") === "trade" ? "trade" : "bot_order";
  const badge = String(g("status_badge") ?? "open") as AdminTradeLedgerRow["statusBadge"];
  const validBadges: AdminTradeLedgerRow["statusBadge"][] = [
    "filled",
    "partial_fill",
    "open",
    "cancelled",
    "failed",
  ];
  return {
    ledgerKind: kind,
    ledgerId: String(g("ledger_id")),
    botOrderId: g("bot_order_id") != null ? String(g("bot_order_id")) : null,
    userEmail: String(g("user_email")),
    userName: g("user_name") != null ? String(g("user_name")) : null,
    strategyName: String(g("strategy_name")),
    symbol: String(g("symbol")),
    side: g("side") === "sell" ? "sell" : "buy",
    quantity: String(g("quantity") ?? "0"),
    entryPrice: g("entry_price") != null ? String(g("entry_price")) : null,
    exitPrice: g("exit_price") != null ? String(g("exit_price")) : null,
    netPnlInr: g("net_pnl_inr") != null ? String(g("net_pnl_inr")) : null,
    revenueShareFeeInr: String(g("revenue_share_fee_inr") ?? "0"),
    venueOrderId: g("venue_order_id") != null ? String(g("venue_order_id")) : null,
    statusBadge: validBadges.includes(badge) ? badge : "open",
    execFailed: g("exec_failed") === true || g("exec_failed") === "t",
    retryCount: Number(g("retry_count") ?? 0),
    sourceTag: g("source_tag") === "manual" ? "manual" : "bot",
    sortTs: new Date(String(g("sort_ts"))).toISOString(),
  };
}

/**
 * Unified admin ledger: all `bot_orders` ∪ all `trades` with user/strategy joins in-SQL (no N+1).
 * Revenue share fee uses the same override LATERAL as the user ledger.
 */
export async function getAdminTradesLedger(
  filters: AdminTradeLedgerFilters,
  pageSize: number = PAGE_SIZE_DEFAULT,
): Promise<AdminTradeLedgerResult | null> {
  if (!db) return null;

  const ps = Math.min(Math.max(pageSize, 1), PAGE_SIZE_MAX);
  const page = Math.max(1, filters.page);
  const offset = (page - 1) * ps;

  const outerParts: SQL[] = [sql`true`];

  if (assertYmd(filters.dateFromIst)) {
    outerParts.push(
      sql`(timezone('Asia/Kolkata', ledger.sort_ts))::date >= ${filters.dateFromIst}::date`,
    );
  }
  if (assertYmd(filters.dateToIst)) {
    outerParts.push(
      sql`(timezone('Asia/Kolkata', ledger.sort_ts))::date <= ${filters.dateToIst}::date`,
    );
  }

  if (filters.userQ?.trim()) {
    const raw = filters.userQ.trim().slice(0, 120);
    const p = `%${raw.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    outerParts.push(
      sql`(ledger.user_email ILIKE ${p} OR COALESCE(ledger.user_name, '') ILIKE ${p})`,
    );
  }

  if (assertUuid(filters.strategyId)) {
    outerParts.push(sql`ledger.strategy_id = ${filters.strategyId}::uuid`);
  }

  if (filters.pnl === "profit") {
    outerParts.push(sql`COALESCE(ledger.net_pnl_numeric, 0) > 0`);
  } else if (filters.pnl === "loss") {
    outerParts.push(sql`COALESCE(ledger.net_pnl_numeric, 0) < 0`);
  }

  if (filters.execOutcome === "failure") {
    outerParts.push(sql`ledger.exec_failed = true`);
  } else if (filters.execOutcome === "success") {
    outerParts.push(sql`ledger.exec_failed = false`);
  }

  const outerWhere = sql.join(outerParts, sql` AND `);

  const ledgerUnion = sql`
    (
      SELECT
        'bot_order'::text AS ledger_kind,
        bo.id::text AS ledger_id,
        bo.id::text AS bot_order_id,
        u.email AS user_email,
        u.name AS user_name,
        bo.symbol,
        bo.side::text AS side,
        bo.strategy_id,
        s.name AS strategy_name,
        bo.quantity::text AS quantity,
        COALESCE(bo.limit_price, bo.fill_price)::text AS entry_price,
        bo.fill_price::text AS exit_price,
        bo.realized_pnl_inr::text AS net_pnl_inr,
        CAST(COALESCE(bo.realized_pnl_inr, 0) AS numeric) AS net_pnl_numeric,
        (
          GREATEST(0, COALESCE(bo.realized_pnl_inr, 0)::numeric)
          * (
            COALESCE(
              ovr.revenue_share_percent_override,
              s.default_revenue_share_percent
            )::numeric
            / 100.0
          )
        )::text AS revenue_share_fee_inr,
        bo.external_order_id::text AS venue_order_id,
        CASE
          WHEN bo.status = 'filled' THEN 'filled'
          WHEN bo.status = 'partial_fill' THEN 'partial_fill'
          WHEN bo.status = 'cancelled' THEN 'cancelled'
          WHEN bo.status IN ('failed', 'rejected') THEN 'failed'
          ELSE 'open'
        END::text AS status_badge,
        (bo.status IN ('failed', 'rejected')) AS exec_failed,
        bo.retry_count::int AS retry_count,
        bo.trade_source::text AS source_tag,
        COALESCE(bo.last_synced_at, bo.updated_at, bo.created_at) AS sort_ts
      FROM bot_orders bo
      INNER JOIN users u ON u.id = bo.user_id
      INNER JOIN strategies s ON s.id = bo.strategy_id
      LEFT JOIN LATERAL (
        SELECT uspo.revenue_share_percent_override
        FROM user_strategy_pricing_overrides uspo
        WHERE uspo.user_id = bo.user_id
          AND uspo.strategy_id = bo.strategy_id
          AND uspo.is_active = true
          AND uspo.effective_from <= COALESCE(bo.last_synced_at, bo.updated_at, bo.created_at)
          AND (
            uspo.effective_until IS NULL
            OR uspo.effective_until > COALESCE(bo.last_synced_at, bo.updated_at, bo.created_at)
          )
        ORDER BY uspo.effective_from DESC
        LIMIT 1
      ) ovr ON true
      WHERE u.deleted_at IS NULL
    )
    UNION ALL
    (
      SELECT
        'trade'::text AS ledger_kind,
        t.id::text AS ledger_id,
        NULL::text AS bot_order_id,
        u.email AS user_email,
        u.name AS user_name,
        t.symbol,
        t.side::text AS side,
        t.strategy_id,
        s.name AS strategy_name,
        t.quantity::text AS quantity,
        t.price::text AS entry_price,
        t.price::text AS exit_price,
        t.realized_pnl_inr::text AS net_pnl_inr,
        CAST(COALESCE(t.realized_pnl_inr, 0) AS numeric) AS net_pnl_numeric,
        (
          GREATEST(0, COALESCE(t.realized_pnl_inr, 0)::numeric)
          * (
            COALESCE(
              ovr.revenue_share_percent_override,
              s.default_revenue_share_percent
            )::numeric
            / 100.0
          )
        )::text AS revenue_share_fee_inr,
        t.external_trade_id::text AS venue_order_id,
        'filled'::text AS status_badge,
        false AS exec_failed,
        0::int AS retry_count,
        'manual'::text AS source_tag,
        t.executed_at AS sort_ts
      FROM trades t
      INNER JOIN users u ON u.id = t.user_id
      INNER JOIN strategies s ON s.id = t.strategy_id
      LEFT JOIN LATERAL (
        SELECT uspo.revenue_share_percent_override
        FROM user_strategy_pricing_overrides uspo
        WHERE uspo.user_id = t.user_id
          AND uspo.strategy_id = t.strategy_id
          AND uspo.is_active = true
          AND uspo.effective_from <= t.executed_at
          AND (
            uspo.effective_until IS NULL
            OR uspo.effective_until > t.executed_at
          )
        ORDER BY uspo.effective_from DESC
        LIMIT 1
      ) ovr ON true
      WHERE u.deleted_at IS NULL
    )
  `;

  const baseFrom = sql`(${ledgerUnion}) AS ledger`;

  const countResult = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM ${baseFrom}
    WHERE ${outerWhere}
  `);
  const countRows = Array.from(
    countResult as unknown as Iterable<{ c: number }>,
  );
  const total = Number(countRows[0]?.c ?? 0);

  const sumResult = await db.execute(sql`
    SELECT
      coalesce(sum(ledger.net_pnl_numeric), 0)::text AS sum_pnl,
      coalesce(sum(cast(ledger.revenue_share_fee_inr AS numeric)), 0)::text AS sum_rev,
      coalesce(sum(CASE WHEN ledger.exec_failed THEN 0 ELSE 1 END), 0)::bigint AS ok_cnt,
      count(*)::bigint AS all_cnt
    FROM ${baseFrom}
    WHERE ${outerWhere}
  `);
  const sumRows = Array.from(
    sumResult as unknown as Iterable<{
      sum_pnl: string;
      sum_rev: string;
      ok_cnt: bigint;
      all_cnt: bigint;
    }>,
  );
  const sr = sumRows[0];
  const allCnt = Number(sr?.all_cnt ?? 0);
  const okCnt = Number(sr?.ok_cnt ?? 0);
  const ratePct =
    allCnt > 0 ? ((okCnt / allCnt) * 100).toFixed(1) : "0.0";

  const dataResult = await db.execute(sql`
    SELECT
      ledger_kind,
      ledger_id,
      bot_order_id,
      user_email,
      user_name,
      symbol,
      side,
      strategy_name,
      quantity,
      entry_price,
      exit_price,
      net_pnl_inr,
      revenue_share_fee_inr,
      venue_order_id,
      status_badge,
      exec_failed,
      retry_count,
      source_tag,
      sort_ts
    FROM ${baseFrom}
    WHERE ${outerWhere}
    ORDER BY sort_ts DESC
    LIMIT ${ps}
    OFFSET ${offset}
  `);

  const rows = Array.from(
    dataResult as unknown as Iterable<Record<string, unknown>>,
  ).map(mapLedgerRow);

  return {
    rows,
    total,
    page,
    pageSize: ps,
    summary: {
      totalNetPnlInr: sr?.sum_pnl ?? "0",
      totalRevenueShareInr: sr?.sum_rev ?? "0",
      executionSuccessRatePct: ratePct,
    },
  };
}

/** Latest execution logs for the given bot order ids (single round-trip). */
export async function listBotExecutionLogsForOrderIds(
  botOrderIds: string[],
): Promise<AdminBotExecutionLogRow[]> {
  if (!db || botOrderIds.length === 0) return [];

  const rows = await db
    .select({
      id: botExecutionLogs.id,
      botOrderId: botExecutionLogs.botOrderId,
      level: botExecutionLogs.level,
      message: botExecutionLogs.message,
      rawPayload: botExecutionLogs.rawPayload,
      createdAt: botExecutionLogs.createdAt,
    })
    .from(botExecutionLogs)
    .where(inArray(botExecutionLogs.botOrderId, botOrderIds))
    .orderBy(desc(botExecutionLogs.createdAt))
    .limit(500);

  return rows.map((r) => ({
    id: r.id,
    botOrderId: r.botOrderId,
    level: r.level,
    message: r.message,
    rawPayload: r.rawPayload ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
