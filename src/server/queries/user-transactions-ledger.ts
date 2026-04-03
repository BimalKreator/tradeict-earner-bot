import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/server/db";
import { strategies, userStrategySubscriptions } from "@/server/db/schema";

const PAGE_SIZE_DEFAULT = 20;

export type TransactionLedgerRow = {
  ledgerKind: "bot_order" | "trade";
  ledgerId: string;
  symbol: string;
  side: "buy" | "sell";
  strategyId: string;
  strategyName: string;
  entryTime: string | null;
  exitTime: string | null;
  quantity: string;
  entryPrice: string | null;
  exitPrice: string | null;
  grossAmountInr: string | null;
  feeInr: string | null;
  netPnlInr: string | null;
  revenueShareFeeInr: string;
  uiStatus: string;
  sourceTag: "bot" | "manual";
  sortTs: string;
};

export type TransactionLedgerResult = {
  rows: TransactionLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  summaryNetPnlInr: string;
  summaryRevShareFeeInr: string;
};

export type TransactionLedgerFilters = {
  dateFrom?: string;
  dateTo?: string;
  strategyId?: string;
  symbol?: string;
  /** open | closed | any */
  state: "open" | "closed" | "any";
  /** profit | loss | any */
  pnl: "profit" | "loss" | "any";
  /** bot_only: only bot_orders with trade_source=bot; all: bot_orders + trades */
  source: "bot_only" | "all";
  page: number;
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

function mapRow(r: Record<string, unknown>): TransactionLedgerRow {
  const g = (k: string) => r[k];
  return {
    ledgerKind: g("ledger_kind") === "trade" ? "trade" : "bot_order",
    ledgerId: String(g("ledger_id")),
    symbol: String(g("symbol")),
    side: g("side") === "sell" ? "sell" : "buy",
    strategyId: String(g("strategy_id")),
    strategyName: String(g("strategy_name")),
    entryTime: g("entry_time")
      ? new Date(String(g("entry_time"))).toISOString()
      : null,
    exitTime: g("exit_time")
      ? new Date(String(g("exit_time"))).toISOString()
      : null,
    quantity: String(g("quantity") ?? "0"),
    entryPrice: g("entry_price") != null ? String(g("entry_price")) : null,
    exitPrice: g("exit_price") != null ? String(g("exit_price")) : null,
    grossAmountInr:
      g("gross_amount_inr") != null ? String(g("gross_amount_inr")) : null,
    feeInr: g("fee_inr") != null ? String(g("fee_inr")) : null,
    netPnlInr: g("net_pnl_inr") != null ? String(g("net_pnl_inr")) : null,
    revenueShareFeeInr: String(g("revenue_share_fee_inr") ?? "0"),
    uiStatus: String(g("ui_status")),
    sourceTag: g("source_tag") === "bot" ? "bot" : "manual",
    sortTs: new Date(String(g("sort_ts"))).toISOString(),
  };
}

/**
 * Unified ledger: `bot_orders` ∪ `trades` with revenue share fee =
 * GREATEST(0, net_pnl) × (effective_rev_share_% / 100).
 * Effective % = latest `user_strategy_pricing_overrides.revenue_share_percent_override`
 * for (user, strategy) at the trade timestamp, else `strategies.default_revenue_share_percent`.
 */
export async function getUserTransactionsLedger(
  userId: string,
  filters: TransactionLedgerFilters,
  pageSize: number = PAGE_SIZE_DEFAULT,
): Promise<TransactionLedgerResult | null> {
  if (!db) return null;

  const page = Math.max(1, filters.page);
  const offset = (page - 1) * pageSize;

  const outerParts: SQL[] = [sql`ledger.ledger_user_id = ${userId}::uuid`];

  if (assertYmd(filters.dateFrom)) {
    outerParts.push(
      sql`(timezone('Asia/Kolkata', ledger.sort_ts))::date >= ${filters.dateFrom}::date`,
    );
  }
  if (assertYmd(filters.dateTo)) {
    outerParts.push(
      sql`(timezone('Asia/Kolkata', ledger.sort_ts))::date <= ${filters.dateTo}::date`,
    );
  }
  if (assertUuid(filters.strategyId)) {
    outerParts.push(sql`ledger.strategy_id = ${filters.strategyId}::uuid`);
  }
  if (filters.symbol?.trim()) {
    const raw = filters.symbol.trim().slice(0, 48).replace(/[%_\\]/g, "");
    if (raw.length > 0) {
      outerParts.push(sql`lower(ledger.symbol) LIKE lower(${"%" + raw + "%"})`);
    }
  }

  if (filters.state === "open") {
    outerParts.push(sql`ledger.ui_status = 'open'`);
  } else if (filters.state === "closed") {
    outerParts.push(sql`ledger.ui_status <> 'open'`);
  }

  if (filters.pnl === "profit") {
    outerParts.push(sql`COALESCE(ledger.net_pnl_numeric, 0) > 0`);
  } else if (filters.pnl === "loss") {
    outerParts.push(sql`COALESCE(ledger.net_pnl_numeric, 0) < 0`);
  }

  if (filters.source === "bot_only") {
    outerParts.push(sql`ledger.source_tag = 'bot'`);
  }

  const outerWhere = sql.join(outerParts, sql` AND `);

  const botTradeSourceFilter =
    filters.source === "bot_only"
      ? sql` AND bo.trade_source = 'bot'`
      : sql``;

  const tradesBranchWhere =
    filters.source === "bot_only" ? sql` AND false` : sql``;

  const ledgerUnion = sql`
    (
      SELECT
        'bot_order'::text AS ledger_kind,
        bo.id::text AS ledger_id,
        bo.user_id AS ledger_user_id,
        bo.symbol,
        bo.side::text AS side,
        bo.strategy_id,
        s.name AS strategy_name,
        bo.created_at AS entry_time,
        CASE
          WHEN bo.status IN ('filled', 'cancelled', 'failed', 'rejected')
          THEN COALESCE(bo.last_synced_at, bo.updated_at)
          ELSE NULL
        END AS exit_time,
        bo.quantity::text AS quantity,
        COALESCE(bo.limit_price, bo.fill_price)::text AS entry_price,
        bo.fill_price::text AS exit_price,
        CASE
          WHEN bo.filled_qty IS NOT NULL AND bo.fill_price IS NOT NULL THEN
            (ABS(CAST(bo.filled_qty AS numeric) * CAST(bo.fill_price AS numeric)))::text
          WHEN bo.quantity IS NOT NULL AND bo.fill_price IS NOT NULL THEN
            (ABS(CAST(bo.quantity AS numeric) * CAST(bo.fill_price AS numeric)))::text
          ELSE NULL
        END AS gross_amount_inr,
        NULL::text AS fee_inr,
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
        CASE
          WHEN bo.status = 'filled' THEN 'filled'
          WHEN bo.status IN ('failed', 'rejected') THEN 'failed'
          WHEN bo.status = 'cancelled' THEN 'closed'
          ELSE 'open'
        END::text AS ui_status,
        bo.trade_source::text AS source_tag,
        COALESCE(bo.last_synced_at, bo.updated_at, bo.created_at) AS sort_ts
      FROM bot_orders bo
      INNER JOIN strategies s ON s.id = bo.strategy_id
      LEFT JOIN LATERAL (
        SELECT uspo.revenue_share_percent_override
        FROM user_strategy_pricing_overrides uspo
        WHERE uspo.user_id = bo.user_id
          AND uspo.strategy_id = bo.strategy_id
          AND uspo.effective_from <= COALESCE(bo.last_synced_at, bo.updated_at, bo.created_at)
          AND (
            uspo.effective_until IS NULL
            OR uspo.effective_until > COALESCE(bo.last_synced_at, bo.updated_at, bo.created_at)
          )
        ORDER BY uspo.effective_from DESC
        LIMIT 1
      ) ovr ON true
      WHERE bo.user_id = ${userId}::uuid
      ${botTradeSourceFilter}
    )
    UNION ALL
    (
      SELECT
        'trade'::text AS ledger_kind,
        t.id::text AS ledger_id,
        t.user_id AS ledger_user_id,
        t.symbol,
        t.side::text AS side,
        t.strategy_id,
        s.name AS strategy_name,
        t.executed_at AS entry_time,
        t.executed_at AS exit_time,
        t.quantity::text AS quantity,
        t.price::text AS entry_price,
        t.price::text AS exit_price,
        (ABS(CAST(t.quantity AS numeric) * CAST(t.price AS numeric)))::text AS gross_amount_inr,
        t.fee_inr::text AS fee_inr,
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
        'filled'::text AS ui_status,
        'manual'::text AS source_tag,
        t.executed_at AS sort_ts
      FROM trades t
      INNER JOIN strategies s ON s.id = t.strategy_id
      LEFT JOIN LATERAL (
        SELECT uspo.revenue_share_percent_override
        FROM user_strategy_pricing_overrides uspo
        WHERE uspo.user_id = t.user_id
          AND uspo.strategy_id = t.strategy_id
          AND uspo.effective_from <= t.executed_at
          AND (
            uspo.effective_until IS NULL
            OR uspo.effective_until > t.executed_at
          )
        ORDER BY uspo.effective_from DESC
        LIMIT 1
      ) ovr ON true
      WHERE t.user_id = ${userId}::uuid
      ${tradesBranchWhere}
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
      coalesce(sum(cast(ledger.revenue_share_fee_inr AS numeric)), 0)::text AS sum_rev
    FROM ${baseFrom}
    WHERE ${outerWhere}
  `);
  const sumRows = Array.from(
    sumResult as unknown as Iterable<{ sum_pnl: string; sum_rev: string }>,
  );

  const dataResult = await db.execute(sql`
    SELECT
      ledger_kind,
      ledger_id,
      symbol,
      side,
      strategy_id,
      strategy_name,
      entry_time,
      exit_time,
      quantity,
      entry_price,
      exit_price,
      gross_amount_inr,
      fee_inr,
      net_pnl_inr,
      revenue_share_fee_inr,
      ui_status,
      source_tag,
      sort_ts
    FROM ${baseFrom}
    WHERE ${outerWhere}
    ORDER BY ledger.sort_ts DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `);

  const rows = Array.from(
    dataResult as unknown as Iterable<Record<string, unknown>>,
  ).map(mapRow);

  return {
    rows,
    total,
    page,
    pageSize,
    summaryNetPnlInr: sumRows[0]?.sum_pnl ?? "0",
    summaryRevShareFeeInr: sumRows[0]?.sum_rev ?? "0",
  };
}

export type StrategyFilterOption = { id: string; name: string; slug: string };

export async function getUserStrategiesForTransactionFilters(
  userId: string,
): Promise<StrategyFilterOption[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      slug: strategies.slug,
    })
    .from(userStrategySubscriptions)
    .innerJoin(
      strategies,
      eq(userStrategySubscriptions.strategyId, strategies.id),
    )
    .where(
      and(
        eq(userStrategySubscriptions.userId, userId),
        isNull(userStrategySubscriptions.deletedAt),
        isNull(strategies.deletedAt),
      ),
    )
    .orderBy(desc(userStrategySubscriptions.updatedAt), strategies.name);

  const seen = new Set<string>();
  const out: StrategyFilterOption[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.name, slug: r.slug });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseTransactionSearchParams(
  sp: Record<string, string | string[] | undefined>,
): TransactionLedgerFilters {
  const g = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const state = g("state");
  const pnl = g("pnl");
  const source = g("source");
  const pageRaw = g("page");
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  const stratRaw = g("strategy");
  const strategyId =
    stratRaw &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      stratRaw,
    )
      ? stratRaw
      : undefined;

  return {
    dateFrom: g("from"),
    dateTo: g("to"),
    strategyId,
    symbol: g("symbol"),
    state:
      state === "open" || state === "closed" ? state : "any",
    pnl: pnl === "profit" || pnl === "loss" ? pnl : "any",
    source: source === "bot_only" ? "bot_only" : "all",
    page,
  };
}
