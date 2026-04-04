/**
 * Applying a revenue-share payment amount against ledger due/paid (webhook path).
 */

export function applyRevenuePaymentToLedgerAmounts(params: {
  amountDueInr: number;
  amountPaidInr: number;
  paymentAmountInr: number;
}): { newPaid: number; fullySettled: boolean } {
  const { amountDueInr: due, amountPaidInr: prevPaid, paymentAmountInr: payAmt } =
    params;
  const combined = prevPaid + payAmt;
  const newPaid = Math.min(combined, due);
  const fullySettled = newPaid >= due - 0.009;
  return { newPaid, fullySettled };
}
