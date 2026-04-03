import {
  assertExchangeSecretsKeyConfigured,
  decryptExchangeSecret,
} from "@/server/exchange/exchange-secrets-crypto";

import type { ExchangeTradingAdapter } from "./exchange-adapter-types";
import { DeltaIndiaTradingAdapter } from "./delta-india-trading-adapter";
import { MockExchangeAdapter } from "./mock-exchange-adapter";

export type ResolvedAdapter =
  | { ok: true; adapter: ExchangeTradingAdapter }
  | { ok: false; error: string };

/**
 * Chooses mock vs live Delta adapter from env + stored credentials.
 */
export async function resolveExchangeTradingAdapter(params: {
  provider: "delta_india";
  apiKeyCiphertext: string;
  apiSecretCiphertext: string;
}): Promise<ResolvedAdapter> {
  const tradingEnabled =
    process.env.DELTA_TRADING_ENABLED?.trim().toLowerCase() === "true";

  if (!tradingEnabled) {
    return { ok: true, adapter: new MockExchangeAdapter() };
  }

  if (params.provider !== "delta_india") {
    return { ok: false, error: "Unsupported exchange provider." };
  }

  let apiKey: string;
  let apiSecret: string;
  try {
    const encKey = assertExchangeSecretsKeyConfigured();
    apiKey = decryptExchangeSecret(params.apiKeyCiphertext, encKey);
    apiSecret = decryptExchangeSecret(params.apiSecretCiphertext, encKey);
  } catch {
    return { ok: false, error: "Could not decrypt exchange credentials." };
  }

  return {
    ok: true,
    adapter: new DeltaIndiaTradingAdapter(apiKey, apiSecret),
  };
}
