import { afterEach, describe, expect, it } from "vitest";

import { revenueShareBlockDueCutoff } from "./revenue-due-gate";

describe("revenueShareBlockDueCutoff", () => {
  const prev = process.env.REVENUE_SHARE_BLOCK_GRACE_HOURS;

  afterEach(() => {
    if (prev === undefined) delete process.env.REVENUE_SHARE_BLOCK_GRACE_HOURS;
    else process.env.REVENUE_SHARE_BLOCK_GRACE_HOURS = prev;
  });

  it("defaults to now (no grace)", () => {
    delete process.env.REVENUE_SHARE_BLOCK_GRACE_HOURS;
    const c = revenueShareBlockDueCutoff();
    const skew = Math.abs(c.getTime() - Date.now());
    expect(skew).toBeLessThan(5000);
  });

  it("subtracts grace hours from now", () => {
    process.env.REVENUE_SHARE_BLOCK_GRACE_HOURS = "48";
    const c = revenueShareBlockDueCutoff();
    const approx = Date.now() - 48 * 3_600_000;
    expect(Math.abs(c.getTime() - approx)).toBeLessThan(5000);
  });
});
