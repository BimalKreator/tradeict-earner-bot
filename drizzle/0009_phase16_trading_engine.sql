CREATE TYPE "public"."bot_order_status" AS ENUM('draft', 'queued', 'submitting', 'open', 'filled', 'partial_fill', 'cancelled', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."trading_job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "bot_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_client_order_id" text NOT NULL,
	"correlation_id" text,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"exchange_connection_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"order_type" text DEFAULT 'market' NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"limit_price" numeric(24, 8),
	"status" "bot_order_status" DEFAULT 'draft' NOT NULL,
	"external_order_id" text,
	"external_client_order_id" text,
	"last_synced_at" timestamp with time zone,
	"raw_submit_response" jsonb,
	"raw_sync_response" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_orders_internal_client_order_id_unique" UNIQUE("internal_client_order_id")
);--> statement-breakpoint
CREATE TABLE "bot_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"net_quantity" numeric(24, 8) DEFAULT '0' NOT NULL,
	"average_entry_price" numeric(24, 8),
	"unrealized_pnl_inr" numeric(14, 2),
	"metadata" jsonb,
	"opened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_positions_subscription_symbol_uidx" UNIQUE("subscription_id","symbol")
);--> statement-breakpoint
CREATE TABLE "trading_execution_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_kind" text DEFAULT 'execute_strategy_signal' NOT NULL,
	"correlation_id" text NOT NULL,
	"status" "trading_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_run_id_user_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."user_strategy_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_orders_user_created_idx" ON "bot_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_orders_subscription_idx" ON "bot_orders" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "bot_orders_correlation_idx" ON "bot_orders" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "bot_positions_user_idx" ON "bot_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_jobs_status_run_idx" ON "trading_execution_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "trading_jobs_correlation_idx" ON "trading_execution_jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_orders_correlation_subscription_uidx" ON "bot_orders" ("correlation_id","subscription_id") WHERE "correlation_id" IS NOT NULL;--> statement-breakpoint
