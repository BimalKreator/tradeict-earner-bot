-- Per-run JSON settings (e.g. Hedge Scalping symbol chosen by the user).
ALTER TABLE "user_strategy_runs" ADD COLUMN IF NOT EXISTS "run_settings_json" jsonb;
--> statement-breakpoint
ALTER TABLE "virtual_strategy_runs" ADD COLUMN IF NOT EXISTS "run_settings_json" jsonb;
