/**
 * Serializable dashboard payload (API + RSC props). Kept out of `server/` so client components can import safely.
 */
export type UserDashboardTradeRow = {
  id: string;
  symbol: string;
  side: string;
  quantity: string;
  priceOrFill: string | null;
  pnlInr: string | null;
  at: string;
  strategyName?: string;
  orderStatus?: string;
  /** Delta profile label when multi-account bot orders are shown. */
  exchangeAccountLabel?: string | null;
};

export type UserDashboardExchangePnlRow = {
  connectionId: string;
  accountLabel: string;
  pnlInr: string;
};

export type UserDashboardData = {
  asOf: string;
  todayBotPnlInr: string;
  totalBotPnlInr: string;
  runsActive: number;
  runsPaused: number;
  runsInactive: number;
  exchange: {
    label: "Connected" | "Invalid" | "Disabled" | "Needs attention" | "Not linked";
    connectionStatus: string | null;
    lastTestStatus: string | null;
  };
  revenueDueWeekInr: string;
  /** True when any strategy run is in `blocked_revenue_due` (new entries paused; exits still allowed). */
  botEntriesPausedRevenueShare: boolean;
  chartBot: { date: string; pnlInr: string }[];
  chartAll: { date: string; pnlInr: string }[];
  /** Realized bot PnL grouped by saved Delta profile (365d bot fills). */
  botPnlByExchangeAccount: UserDashboardExchangePnlRow[];
  botTrades: UserDashboardTradeRow[];
  allTrades: UserDashboardTradeRow[];
};
