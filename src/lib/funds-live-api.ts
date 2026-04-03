import type { DeltaWalletMovement } from "@/server/exchange/delta-india-wallet-types";

export type FundsLiveApiOk = {
  ok: true;
  asOf: string;
  liveBalance: string | null;
  availableMargin: string | null;
  netEquity: string | null;
  netFundFlow: string | null;
  netExternalMovementHint: string | null;
  movements: DeltaWalletMovement[];
  balanceError?: string;
  transactionError?: string;
};

export type FundsLiveApiErr = {
  ok: false;
  code: string;
  message: string;
};

export type FundsLiveApiResponse = FundsLiveApiOk | FundsLiveApiErr;

export function isFundsLiveOk(
  r: FundsLiveApiResponse,
): r is FundsLiveApiOk {
  return r.ok === true;
}
