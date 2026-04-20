export type UserStrategySettingsActionState = {
  ok: boolean | null;
  message: string;
  fieldErrors: Record<string, string>;
};

export const userStrategySettingsActionInitialState: UserStrategySettingsActionState =
  {
    ok: null,
    message: "",
    fieldErrors: {},
  };
