let warned = false;

function isTrue(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "true";
}

/**
 * Loud startup warning for production safety.
 * Emits once per process if live trading is disabled or mock adapter is enabled.
 */
export function logLiveTradingModeWarningOnBoot(context: string): void {
  if (warned) return;
  const liveEnabled = isTrue(process.env.DELTA_TRADING_ENABLED);
  const mockEnabled = isTrue(process.env.MOCK_EXCHANGE_ADAPTER_ENABLED);
  if (liveEnabled && !mockEnabled) return;

  warned = true;
  const reasons: string[] = [];
  if (!liveEnabled) reasons.push("DELTA_TRADING_ENABLED is not true");
  if (mockEnabled) reasons.push("MOCK_EXCHANGE_ADAPTER_ENABLED is true");

  const reasonText = reasons.join(" | ") || "unknown";
  console.warn(
    `[WARNING] 🚨 LIVE TRADING IS DISABLED OR MOCK ADAPTER IS ACTIVE 🚨 Orders will NOT be sent to the real exchange! context=${context} reason=${reasonText}`,
  );
}
