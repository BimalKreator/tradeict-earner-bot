import { describe, expect, it } from "vitest";

import { interpretDeltaWalletHttpResponse } from "./delta-india-client";

describe("interpretDeltaWalletHttpResponse", () => {
  it("treats 200 as success", () => {
    const r = interpretDeltaWalletHttpResponse({
      ok: true,
      status: 200,
      statusText: "OK",
      text: "{}",
      json: {},
    });
    expect(r.ok).toBe(true);
  });

  it("classifies invalid API key (401 / code)", () => {
    const byStatus = interpretDeltaWalletHttpResponse({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: "{}",
      json: {},
    });
    expect(byStatus.ok).toBe(false);
    if (!byStatus.ok) expect(byStatus.kind).toBe("invalid_credentials");

    const byCode = interpretDeltaWalletHttpResponse({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: '{"error":{"code":"invalid_api_key"}}',
      json: { error: { code: "invalid_api_key" } },
    });
    expect(byCode.ok).toBe(false);
    if (!byCode.ok) expect(byCode.kind).toBe("invalid_credentials");
  });

  it("classifies permission / withdraw errors", () => {
    const r = interpretDeltaWalletHttpResponse({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: "withdraw not allowed",
      json: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("permission_denied");
  });

  it("classifies signature issues as invalid_credentials", () => {
    const r = interpretDeltaWalletHttpResponse({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: "signature expired",
      json: { error: { code: "signature_expired" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("invalid_credentials");
  });
});
