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
 * Resolves live Delta adapter for real execution.
 * Mock adapter is permitted only when explicitly enabled for tests/dev.
 */
export async function resolveExchangeTradingAdapter(params: {
  provider: "delta_india";
  apiKeyCiphertext: string;
  apiSecretCiphertext: string;
}): Promise<ResolvedAdapter> {
  const tradingEnabled =
    process.env.DELTA_TRADING_ENABLED?.trim().toLowerCase() === "true";
  const mockAdapterEnabled =
    process.env.MOCK_EXCHANGE_ADAPTER_ENABLED?.trim().toLowerCase() === "true";

  if (!tradingEnabled) {
    if (mockAdapterEnabled) {
      return { ok: true, adapter: new MockExchangeAdapter() };
    }
    return {
      ok: false,
      error:
        "Live Delta trading is disabled (DELTA_TRADING_ENABLED is not true). Refusing implicit mock fallback.",
    };
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
