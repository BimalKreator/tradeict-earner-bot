CREATE TYPE "public"."virtual_strategy_run_status" AS ENUM('active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."hedge_scalping_position_side" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."hedge_scalping_virtual_clip_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."hedge_scalping_virtual_run_status" AS ENUM('active', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "virtual_bot_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_client_order_id" text NOT NULL,
	"correlation_id" text,
	"virtual_run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"order_type" text DEFAULT 'market' NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"limit_price" numeric(24, 8),
	"status" "bot_order_status" DEFAULT 'queued' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"trade_source" "bot_trade_source" DEFAULT 'bot' NOT NULL,
	"venue_order_state" text,
	"fill_price" numeric(24, 8),
	"filled_qty" numeric(24, 8),
	"realized_pnl_usd" numeric(14, 2),
	"profit_percent" numeric(12, 6),
	"signal_action" text,
	"raw_submit_response" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_bot_orders_internal_client_order_id_unique" UNIQUE("internal_client_order_id")
);
--> statement-breakpoint
CREATE TABLE "virtual_strategy_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"status" "virtual_strategy_run_status" DEFAULT 'active' NOT NULL,
	"leverage" numeric(10, 2) DEFAULT '1' NOT NULL,
	"virtual_capital_usd" numeric(14, 2) DEFAULT '10000' NOT NULL,
	"virtual_available_cash_usd" numeric(14, 2) DEFAULT '10000' NOT NULL,
	"virtual_used_margin_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"virtual_realized_pnl_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"open_net_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"open_avg_entry_price" numeric(24, 8),
	"open_symbol" text,
	"run_settings_json" jsonb,
	"activated_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hedge_scalping_virtual_clips" (
	"clip_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_level" integer NOT NULL,
	"entry_price" numeric(24, 8) NOT NULL,
	"side" "hedge_scalping_position_side" NOT NULL,
	"qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"status" "hedge_scalping_virtual_clip_status" DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hedge_scalping_virtual_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"status" "hedge_scalping_virtual_run_status" DEFAULT 'active' NOT NULL,
	"d1_side" "hedge_scalping_position_side" NOT NULL,
	"d1_entry_price" numeric(24, 8) NOT NULL,
	"max_favorable_price" numeric(24, 8) NOT NULL,
	"d1_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_profit_lock_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"timeframe" text DEFAULT '1m' NOT NULL,
	"halftrend_amplitude" integer DEFAULT 2 NOT NULL,
	"symbol" text DEFAULT 'BTCUSD' NOT NULL,
	"d1_capital_allocation_pct" integer DEFAULT 100 NOT NULL,
	"d1_target_pct" integer DEFAULT 12 NOT NULL,
	"d1_stoploss_pct" integer DEFAULT 1 NOT NULL,
	"d1_breakeven_trigger_pct" integer DEFAULT 30 NOT NULL,
	"d2_steps_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_profit_lock_settings_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "live_position_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exchange_connection_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"local_net_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"exchange_net_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"qty_diff" numeric(24, 8) DEFAULT '0' NOT NULL,
	"mismatch" text DEFAULT 'no' NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error_message" text,
	"raw_payload" jsonb,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "bot_orders_correlation_subscription_uidx";--> statement-breakpoint
DROP INDEX "bot_positions_subscription_symbol_uidx";--> statement-breakpoint
ALTER TABLE "exchange_connections" ADD COLUMN "account_label" text DEFAULT 'Account 1' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "settings_json" jsonb;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD COLUMN "primary_exchange_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD COLUMN "secondary_exchange_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD COLUMN "run_settings_json" jsonb;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "exchange_connection_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_bot_orders" ADD CONSTRAINT "virtual_bot_orders_virtual_run_id_virtual_strategy_runs_id_fk" FOREIGN KEY ("virtual_run_id") REFERENCES "public"."virtual_strategy_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_bot_orders" ADD CONSTRAINT "virtual_bot_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_bot_orders" ADD CONSTRAINT "virtual_bot_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_strategy_runs" ADD CONSTRAINT "virtual_strategy_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_strategy_runs" ADD CONSTRAINT "virtual_strategy_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hedge_scalping_virtual_clips" ADD CONSTRAINT "hedge_scalping_virtual_clips_run_id_hedge_scalping_virtual_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hedge_scalping_virtual_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hedge_scalping_virtual_runs" ADD CONSTRAINT "hedge_scalping_virtual_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hedge_scalping_virtual_runs" ADD CONSTRAINT "hedge_scalping_virtual_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_profit_lock_settings" ADD CONSTRAINT "trend_profit_lock_settings_run_id_user_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."user_strategy_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_position_reconciliations" ADD CONSTRAINT "live_position_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_position_reconciliations" ADD CONSTRAINT "live_position_reconciliations_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "virtual_bot_orders_run_created_idx" ON "virtual_bot_orders" USING btree ("virtual_run_id","created_at");--> statement-breakpoint
CREATE INDEX "virtual_bot_orders_user_created_idx" ON "virtual_bot_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "virtual_bot_orders_correlation_idx" ON "virtual_bot_orders" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_bot_orders_correlation_run_uidx" ON "virtual_bot_orders" USING btree ("correlation_id","virtual_run_id") WHERE "virtual_bot_orders"."correlation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_strategy_runs_user_strategy_uidx" ON "virtual_strategy_runs" USING btree ("user_id","strategy_id");--> statement-breakpoint
CREATE INDEX "virtual_strategy_runs_user_idx" ON "virtual_strategy_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "virtual_strategy_runs_status_idx" ON "virtual_strategy_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_clips_run_idx" ON "hedge_scalping_virtual_clips" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_clips_run_status_idx" ON "hedge_scalping_virtual_clips" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hedge_scalping_virtual_clips_run_step_active_uidx" ON "hedge_scalping_virtual_clips" USING btree ("run_id","step_level") WHERE "hedge_scalping_virtual_clips"."status" = 'active';--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_runs_user_idx" ON "hedge_scalping_virtual_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_runs_strategy_idx" ON "hedge_scalping_virtual_runs" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "hedge_scalping_virtual_runs_status_idx" ON "hedge_scalping_virtual_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "hedge_scalping_virtual_runs_user_strategy_active_uidx" ON "hedge_scalping_virtual_runs" USING btree ("user_id","strategy_id") WHERE "hedge_scalping_virtual_runs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "trend_profit_lock_settings_run_idx" ON "trend_profit_lock_settings" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_position_reconciliations_exchange_symbol_uidx" ON "live_position_reconciliations" USING btree ("exchange_connection_id","symbol");--> statement-breakpoint
CREATE INDEX "live_position_reconciliations_user_idx" ON "live_position_reconciliations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "live_position_reconciliations_reconciled_idx" ON "live_position_reconciliations" USING btree ("reconciled_at");--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD CONSTRAINT "user_strategy_runs_primary_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("primary_exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD CONSTRAINT "user_strategy_runs_secondary_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("secondary_exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_connections_user_provider_label_uidx" ON "exchange_connections" USING btree ("user_id","provider","account_label") WHERE "exchange_connections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_orders_correlation_subscription_exchange_uidx" ON "bot_orders" USING btree ("correlation_id","subscription_id","exchange_connection_id") WHERE "bot_orders"."correlation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_positions_subscription_symbol_exchange_uidx" ON "bot_positions" USING btree ("subscription_id","symbol","exchange_connection_id");--> statement-breakpoint
CREATE INDEX "bot_positions_exchange_idx" ON "bot_positions" USING btree ("exchange_connection_id");