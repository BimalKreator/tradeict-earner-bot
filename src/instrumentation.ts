import { validateExchangeSecretsKeyForBoot } from "@/server/exchange/exchange-secrets-boot";
import { logLiveTradingModeWarningOnBoot } from "@/server/trading/live-trading-boot-warning";

/**
 * Runs once when the Node.js server process starts (not Edge).
 * Fails fast if `EXCHANGE_SECRETS_ENCRYPTION_KEY` is set but malformed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  validateExchangeSecretsKeyForBoot();
  logLiveTradingModeWarningOnBoot("web_boot");
}
