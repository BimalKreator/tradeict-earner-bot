import type { TransactionLedgerFilters } from "@/server/queries/user-transactions-ledger";

export function serializeTransactionFilters(
  f: TransactionLedgerFilters,
): URLSearchParams {
  const p = new URLSearchParams();
  if (f.dateFrom) p.set("from", f.dateFrom);
  if (f.dateTo) p.set("to", f.dateTo);
  if (f.strategyId) p.set("strategy", f.strategyId);
  if (f.symbol?.trim()) p.set("symbol", f.symbol.trim());
  if (f.state !== "any") p.set("state", f.state);
  if (f.pnl !== "any") p.set("pnl", f.pnl);
  if (f.source !== "all") p.set("source", f.source);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

export function transactionsPageHref(f: TransactionLedgerFilters): string {
  const q = serializeTransactionFilters(f).toString();
  return q ? `/user/transactions?${q}` : "/user/transactions";
}
