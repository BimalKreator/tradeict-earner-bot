-- Hedge scalping (virtual): paper anchor run + per-step clips (Phase 5/6 schema).
-- Incremental migration — assumes migrations through 0024 are already applied.

CREATE TYPE "public"."hedge_scalping_virtual_run_status" AS ENUM('active', 'completed', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."hedge_scalping_virtual_clip_status" AS ENUM('active', 'completed');
--> statement-breakpoint
CREATE TYPE "public"."hedge_scalping_position_side" AS ENUM('LONG', 'SHORT');
--> statement-breakpoint
CREATE TABLE "public"."hedge_scalping_virtual_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"status" "public"."hedge_scalping_virtual_run_status" DEFAULT 'active' NOT NULL,
	"d1_side" "public"."hedge_scalping_position_side" NOT NULL,
	"d1_entry_price" numeric(24, 8) NOT NULL,
	"max_favorable_price" numeric(24, 8) NOT NULL,
	"d1_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public"."hedge_scalping_virtual_clips" (
	"clip_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_level" integer NOT NULL,
	"entry_price" numeric(24, 8) NOT NULL,
	"side" "public"."hedge_scalping_position_side" NOT NULL,
	"qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"status" "public"."hedge_scalping_virtual_clip_status" DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public"."hedge_scalping_virtual_runs" ADD CONSTRAINT "hedge_scalping_virtual_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public"."hedge_scalping_virtual_runs" ADD CONSTRAINT "hedge_scalping_virtual_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public"."hedge_scalping_virtual_clips" ADD CONSTRAINT "hedge_scalping_virtual_clips_run_id_hedge_scalping_virtual_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hedge_scalping_virtual_runs"("run_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_runs_user_idx" ON "public"."hedge_scalping_virtual_runs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_runs_strategy_idx" ON "public"."hedge_scalping_virtual_runs" USING btree ("strategy_id");
--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_runs_status_idx" ON "public"."hedge_scalping_virtual_runs" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "hedge_scalping_virtual_runs_user_strategy_active_uidx" ON "public"."hedge_scalping_virtual_runs" USING btree ("user_id","strategy_id") WHERE "hedge_scalping_virtual_runs"."status" = 'active';
--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_clips_run_idx" ON "public"."hedge_scalping_virtual_clips" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_clips_run_status_idx" ON "public"."hedge_scalping_virtual_clips" USING btree ("run_id","status");
