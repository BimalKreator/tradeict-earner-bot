import { describe, expect, it } from "vitest";

import { applyRevenuePaymentToLedgerAmounts } from "./revenue-ledger-payment-math";

describe("applyRevenuePaymentToLedgerAmounts", () => {
  it("never pays more than due", () => {
    const r = applyRevenuePaymentToLedgerAmounts({
      amountDueInr: 100,
      amountPaidInr: 0,
      paymentAmountInr: 150,
    });
    expect(r.newPaid).toBe(100);
    expect(r.fullySettled).toBe(true);
  });

  it("partial payment leaves partial state", () => {
    const r = applyRevenuePaymentToLedgerAmounts({
      amountDueInr: 100,
      amountPaidInr: 40,
      paymentAmountInr: 30,
    });
    expect(r.newPaid).toBe(70);
    expect(r.fullySettled).toBe(false);
  });

  it("duplicate overpay webhook still caps at due (idempotent math)", () => {
    const r = applyRevenuePaymentToLedgerAmounts({
      amountDueInr: 50,
      amountPaidInr: 50,
      paymentAmountInr: 50,
    });
    expect(r.newPaid).toBe(50);
    expect(r.fullySettled).toBe(true);
  });
});
