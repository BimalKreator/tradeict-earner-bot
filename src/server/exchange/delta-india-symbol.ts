/**
 * Maps strategy/env symbols (e.g. `BTC_USDT`, `BTCUSDT`) to Delta India REST/catalog symbols
 * (`BTCUSD`, `ETHUSD`). India USD perpetuals do not use underscores; `BTC_USDT` must not be
 * passed to tickers, candles, or product resolution.
 */
export function normalizeDeltaIndiaApiSymbol(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const s = t.replace(/_/g, "").toUpperCase();
  if (s === "BTCUSDT") return "BTCUSD";
  if (s === "ETHUSDT") return "ETHUSD";
  return s;
}
