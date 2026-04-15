-- Trend arbitrage: track which 1% favorable excursion steps already received a Delta 2 hedge clip per run.
CREATE TABLE IF NOT EXISTS trend_arb_hedge_state (
  run_id uuid NOT NULL REFERENCES user_strategy_runs (id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS trend_arb_hedge_state_run_idx ON trend_arb_hedge_state (run_id);
