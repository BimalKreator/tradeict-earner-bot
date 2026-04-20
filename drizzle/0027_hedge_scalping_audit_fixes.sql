ALTER TYPE "public"."virtual_strategy_run_status" ADD VALUE 'completed';--> statement-breakpoint
CREATE UNIQUE INDEX "hedge_scalping_virtual_clips_run_step_active_uidx" ON "hedge_scalping_virtual_clips" ("run_id", "step_level") WHERE "status" = 'active';
