import { describe, expect, it } from "vitest";
import { z } from "zod";

/** Keep in sync with `route.ts` webhook guard. */
const webhookOrderIdSchema = z.string().uuid();

describe("Cashfree webhook order id guard", () => {
  it("accepts payment row UUIDs", () => {
    expect(
      webhookOrderIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000")
        .success,
    ).toBe(true);
  });

  it("rejects arbitrary strings (spoof / malformed payloads)", () => {
    expect(webhookOrderIdSchema.safeParse("cf-order-123").success).toBe(false);
    expect(webhookOrderIdSchema.safeParse("").success).toBe(false);
  });
});
