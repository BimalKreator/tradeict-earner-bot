ALTER TYPE "public"."user_strategy_run_status" ADD VALUE 'ready_to_activate';--> statement-breakpoint
ALTER TYPE "public"."user_strategy_run_status" ADD VALUE 'paused_by_user';--> statement-breakpoint
UPDATE "user_strategy_runs" SET "status" = 'paused_by_user' WHERE "status" = 'paused';--> statement-breakpoint
