import {
  deltaIndiaDefaultBaseUrl,
  signDeltaIndiaRequest,
} from "./delta-india-sign";

export type DeltaWalletTestResult =
  | { ok: true; message: string }
  | {
      ok: false;
      kind: "invalid_credentials" | "permission_denied" | "failure";
      message: string;
      httpStatus?: number;
    };

/**
 * Authenticated GET to `/v2/wallet/balances` — read-only connectivity check.
 * @see https://docs.delta.exchange/ — signing: method + timestamp + path + query + body (hex HMAC-SHA256)
 */
export async function testDeltaIndiaWalletAccess(params: {
  apiKey: string;
  apiSecret: string;
}): Promise<DeltaWalletTestResult> {
  const base = deltaIndiaDefaultBaseUrl();
  const method = "GET";
  const path = "/v2/wallet/balances";
  const queryString = "";
  const body = "";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signDeltaIndiaRequest(
    params.apiSecret,
    method,
    timestamp,
    path,
    queryString,
    body,
  );

  const url = `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "api-key": params.apiKey,
        timestamp,
        signature,
        "User-Agent": "TradeictEarner/1.0 (Node)",
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      kind: "failure",
      message: `Network error calling Delta India: ${msg}`,
    };
  }

  const text = await res.text();
  let json: { error?: { code?: string; message?: string }; success?: boolean } =
    {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    /* non-JSON body */
  }

  const errCode = json.error?.code ?? "";
  const errMsg = (
    json.error?.message ??
    (text.slice(0, 200) || res.statusText)
  ).toLowerCase();

  if (res.ok) {
    return {
      ok: true,
      message: "Wallet reachable — balances API responded successfully.",
    };
  }

  if (res.status === 401 || errCode === "invalid_api_key") {
    return {
      ok: false,
      kind: "invalid_credentials",
      message: "Invalid API key or signature (check key and secret).",
      httpStatus: res.status,
    };
  }

  if (
    res.status === 403 ||
    errCode === "forbidden" ||
    errMsg.includes("permission") ||
    errMsg.includes("withdraw") ||
    errMsg.includes("not allowed")
  ) {
    return {
      ok: false,
      kind: "permission_denied",
      message:
        "Permission denied — use a key without withdrawal rights and with read/trade scope as required by Delta.",
      httpStatus: res.status,
    };
  }

  if (errCode === "signature_expired" || errMsg.includes("signature")) {
    return {
      ok: false,
      kind: "invalid_credentials",
      message: "Signature rejected or expired — retry; ensure server time is accurate.",
      httpStatus: res.status,
    };
  }

  return {
    ok: false,
    kind: "failure",
    message: `Delta API error (${res.status}): ${text.slice(0, 180)}`,
    httpStatus: res.status,
  };
}
