import { describe, expect, it } from "vitest";

import { generateOtpDigits } from "./otp";

describe("generateOtpDigits", () => {
  it("produces a string of the requested length", () => {
    const code = generateOtpDigits(6);
    expect(code).toMatch(/^\d{6}$/);
  });
});
