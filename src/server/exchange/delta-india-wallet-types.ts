/** Parsed Delta India `GET /v2/wallet/balances` (subset used by Tradeict Earner UI). */
export type DeltaWalletBalanceSnapshot = {
  ok: true;
  netEquity: string | null;
  /** Sum of `available_balance` across returned asset rows (UI “available margin”). */
  availableMarginTotal: string | null;
  /**
   * USD total for UI: `meta.net_equity` (string or number), else sum of USD-stable
   * wallet balances, else legacy INR row — never a random first-row balance.
   */
  liveBalanceDisplay: string | null;
  assetRows: Array<{
    assetSymbol: string;
    balance: string | null;
    availableBalance: string | null;
  }>;
  rawMeta: Record<string, unknown> | null;
};

export type DeltaWalletBalanceError = {
  ok: false;
  error: string;
  httpStatus?: number;
};

export type DeltaWalletMovement = {
  id: string;
  amount: string;
  balanceAfter: string | null;
  transactionType: string;
  assetSymbol: string;
  createdAt: string | null;
};

export type DeltaWalletTransactionsSnapshot = {
  ok: true;
  movements: DeltaWalletMovement[];
};

export type DeltaWalletTransactionsError = {
  ok: false;
  error: string;
  httpStatus?: number;
};
