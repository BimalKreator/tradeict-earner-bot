export type StrategyRunActionState = {
  ok: boolean | null;
  message: string;
  /** When set, client should show a link to complete capital / leverage. */
  settingsHref?: string;
};

export const strategyRunActionInitialState: StrategyRunActionState = {
  ok: null,
  message: "",
};
