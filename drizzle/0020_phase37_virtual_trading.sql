CREATE TYPE "public"."virtual_strategy_run_status" AS ENUM('active', 'paused');--> statement-breakpoint
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
	"activated_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "virtual_strategy_runs" ADD CONSTRAINT "virtual_strategy_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_strategy_runs" ADD CONSTRAINT "virtual_strategy_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_bot_orders" ADD CONSTRAINT "virtual_bot_orders_virtual_run_id_virtual_strategy_runs_id_fk" FOREIGN KEY ("virtual_run_id") REFERENCES "public"."virtual_strategy_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_bot_orders" ADD CONSTRAINT "virtual_bot_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_bot_orders" ADD CONSTRAINT "virtual_bot_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_strategy_runs_user_strategy_uidx" ON "virtual_strategy_runs" USING btree ("user_id","strategy_id");--> statement-breakpoint
CREATE INDEX "virtual_strategy_runs_user_idx" ON "virtual_strategy_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "virtual_strategy_runs_status_idx" ON "virtual_strategy_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "virtual_bot_orders_run_created_idx" ON "virtual_bot_orders" USING btree ("virtual_run_id","created_at");--> statement-breakpoint
CREATE INDEX "virtual_bot_orders_user_created_idx" ON "virtual_bot_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "virtual_bot_orders_correlation_idx" ON "virtual_bot_orders" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_bot_orders_correlation_run_uidx" ON "virtual_bot_orders" USING btree ("correlation_id","virtual_run_id") WHERE "virtual_bot_orders"."correlation_id" IS NOT NULL;
