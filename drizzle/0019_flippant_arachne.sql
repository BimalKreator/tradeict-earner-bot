CREATE TYPE "public"."bot_order_status" AS ENUM('draft', 'queued', 'submitting', 'open', 'filled', 'partial_fill', 'cancelled', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."bot_trade_source" AS ENUM('bot', 'manual');--> statement-breakpoint
CREATE TYPE "public"."notification_log_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."strategy_risk_label" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."strategy_visibility" AS ENUM('public', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."terms_document_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."trading_job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'dead');--> statement-breakpoint
ALTER TYPE "public"."exchange_connection_test_status" ADD VALUE 'invalid_credentials';--> statement-breakpoint
ALTER TYPE "public"."exchange_connection_test_status" ADD VALUE 'permission_denied';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'created';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."user_strategy_run_status" ADD VALUE 'paused_insufficient_funds' BEFORE 'paused_admin';--> statement-breakpoint
ALTER TYPE "public"."user_strategy_run_status" ADD VALUE 'ready_to_activate';--> statement-breakpoint
ALTER TYPE "public"."user_strategy_run_status" ADD VALUE 'paused_by_user';--> statement-breakpoint
CREATE TABLE "bot_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_order_id" uuid NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"trade_source" "bot_trade_source" DEFAULT 'bot' NOT NULL,
	"venue_order_state" text,
	"fill_price" numeric(24, 8),
	"filled_qty" numeric(24, 8),
	"realized_pnl_inr" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_orders_internal_client_order_id_unique" UNIQUE("internal_client_order_id")
);
--> statement-breakpoint
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE TABLE "terms_and_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_name" text NOT NULL,
	"content" text NOT NULL,
	"status" "terms_document_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_accepted_terms" (
	"user_id" uuid NOT NULL,
	"terms_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_accepted_terms_user_id_terms_id_pk" PRIMARY KEY("user_id","terms_id")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" "notification_log_status" NOT NULL,
	"metadata" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_internal_notes" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "visibility" "strategy_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "risk_label" "strategy_risk_label" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "recommended_capital_inr" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "max_leverage" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "performance_chart_json" jsonb;--> statement-breakpoint
ALTER TABLE "user_strategy_pricing_overrides" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_strategy_pricing_overrides" ADD COLUMN "admin_notes" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "strategy_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "revenue_share_ledger_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "admin_notes" text;--> statement-breakpoint
ALTER TABLE "weekly_revenue_share_ledgers" ADD COLUMN "revenue_share_percent_applied" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_revenue_share_ledgers" ADD COLUMN "admin_notes" text;--> statement-breakpoint
ALTER TABLE "bot_execution_logs" ADD CONSTRAINT "bot_execution_logs_bot_order_id_bot_orders_id_fk" FOREIGN KEY ("bot_order_id") REFERENCES "public"."bot_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_run_id_user_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."user_strategy_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accepted_terms" ADD CONSTRAINT "user_accepted_terms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accepted_terms" ADD CONSTRAINT "user_accepted_terms_terms_id_terms_and_conditions_id_fk" FOREIGN KEY ("terms_id") REFERENCES "public"."terms_and_conditions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_execution_logs_order_created_idx" ON "bot_execution_logs" USING btree ("bot_order_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_orders_user_created_idx" ON "bot_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_orders_subscription_idx" ON "bot_orders" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "bot_orders_correlation_idx" ON "bot_orders" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "bot_orders_user_pnl_day_idx" ON "bot_orders" USING btree ("user_id","last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_orders_correlation_subscription_uidx" ON "bot_orders" USING btree ("correlation_id","subscription_id") WHERE "bot_orders"."correlation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_positions_subscription_symbol_uidx" ON "bot_positions" USING btree ("subscription_id","symbol");--> statement-breakpoint
CREATE INDEX "bot_positions_user_idx" ON "bot_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_jobs_status_run_idx" ON "trading_execution_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "trading_jobs_correlation_idx" ON "trading_execution_jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "tac_status_idx" ON "terms_and_conditions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tac_updated_at_idx" ON "terms_and_conditions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tac_single_published_uidx" ON "terms_and_conditions" USING btree ("status") WHERE "terms_and_conditions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "uat_user_idx" ON "user_accepted_terms" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uat_terms_idx" ON "user_accepted_terms" USING btree ("terms_id");--> statement-breakpoint
CREATE INDEX "notification_logs_user_sent_idx" ON "notification_logs" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "notification_logs_type_sent_idx" ON "notification_logs" USING btree ("type","sent_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_revenue_share_ledger_id_weekly_revenue_share_ledgers_id_fk" FOREIGN KEY ("revenue_share_ledger_id") REFERENCES "public"."weekly_revenue_share_ledgers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategies_visibility_idx" ON "strategies" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "uspo_user_strategy_active_from_idx" ON "user_strategy_pricing_overrides" USING btree ("user_id","strategy_id","is_active","effective_from");--> statement-breakpoint
CREATE INDEX "payments_strategy_id_idx" ON "payments" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "payments_revenue_ledger_idx" ON "payments" USING btree ("revenue_share_ledger_id");