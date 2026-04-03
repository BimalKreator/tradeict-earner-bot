export type TradingLogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured logs for the trading engine (stdout JSON lines; ship to a log stack later).
 */
export function tradingLog(
  level: TradingLogLevel,
  event: string,
  data: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    svc: "trading_engine",
    level,
    event,
    ...data,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
