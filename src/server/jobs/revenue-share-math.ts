/**
 * Pure helpers for weekly revenue share calculations (used by engine + tests).
 */

export function toMoneyString(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function weeklyAmountDue(weeklyNetProfit: number, percentStr: string): string {
  const p = Number(percentStr);
  if (weeklyNetProfit <= 0 || !Number.isFinite(p) || p <= 0) return "0.00";
  const due = (weeklyNetProfit * p) / 100;
  return toMoneyString(due);
}
