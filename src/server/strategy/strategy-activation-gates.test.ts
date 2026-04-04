import { describe, expect, it } from "vitest";

import {
  activationRevenueDueBlockMessage,
  canActivateFromRunStatus,
  subscriptionActiveEntitled,
} from "./strategy-activation-gates";

describe("subscriptionActiveEntitled", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");

  it("requires active status and future access end", () => {
    expect(
      subscriptionActiveEntitled(
        "active",
        new Date("2026-02-01T00:00:00.000Z"),
        now,
      ),
    ).toBe(true);
    expect(
      subscriptionActiveEntitled(
        "active",
        new Date("2026-01-01T00:00:00.000Z"),
        now,
      ),
    ).toBe(false);
    expect(
      subscriptionActiveEntitled(
        "purchased_pending_activation",
        new Date("2026-02-01T00:00:00.000Z"),
        now,
      ),
    ).toBe(false);
  });
});

describe("activationRevenueDueBlockMessage", () => {
  it("blocks paused and blocked revenue states", () => {
    expect(activationRevenueDueBlockMessage("paused_revenue_due")).toContain("overdue");
    expect(activationRevenueDueBlockMessage("blocked_revenue_due")).toContain("revenue");
    expect(activationRevenueDueBlockMessage("paused_admin")).toContain("support");
    expect(activationRevenueDueBlockMessage("ready_to_activate")).toBeNull();
  });
});

describe("canActivateFromRunStatus", () => {
  it("allows ready_to_activate and exchange-off pause", () => {
    expect(canActivateFromRunStatus("ready_to_activate")).toBe(true);
    expect(canActivateFromRunStatus("paused_exchange_off")).toBe(true);
    expect(canActivateFromRunStatus("active")).toBe(false);
    expect(canActivateFromRunStatus("expired")).toBe(false);
  });
});
