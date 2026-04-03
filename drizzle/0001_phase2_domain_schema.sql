CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('admin', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."email_log_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."exchange_connection_status" AS ENUM('active', 'disabled_user', 'disabled_admin', 'error');--> statement-breakpoint
CREATE TYPE "public"."exchange_connection_test_status" AS ENUM('unknown', 'success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."exchange_provider" AS ENUM('delta_india');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'verify_email', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('cashfree');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."profile_change_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."reminder_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('payment_due', 'revenue_due', 'onboarding', 'custom');--> statement-breakpoint
CREATE TYPE "public"."revenue_ledger_status" AS ENUM('unpaid', 'partial', 'paid', 'waived');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('active', 'paused', 'hidden', 'archived');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."user_approval_status" AS ENUM('pending', 'approved', 'rejected', 'paused');--> statement-breakpoint
CREATE TYPE "public"."user_strategy_run_status" AS ENUM('inactive', 'active', 'paused', 'paused_revenue_due', 'paused_exchange_off', 'paused_admin', 'expired', 'blocked_revenue_due');--> statement-breakpoint
CREATE TYPE "public"."user_strategy_subscription_status" AS ENUM('purchased_pending_activation', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'staff' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"phone" text,
	"password_hash" text,
	"approval_status" "user_approval_status" DEFAULT 'pending' NOT NULL,
	"approval_notes" text,
	"approved_at" timestamp with time zone,
	"approved_by_admin_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "login_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"code_hash" text NOT NULL,
	"purpose" "otp_purpose" DEFAULT 'login' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_address" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "exchange_provider" DEFAULT 'delta_india' NOT NULL,
	"status" "exchange_connection_status" DEFAULT 'active' NOT NULL,
	"api_key_ciphertext" text DEFAULT '' NOT NULL,
	"api_secret_ciphertext" text DEFAULT '' NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_status" "exchange_connection_test_status" DEFAULT 'unknown' NOT NULL,
	"last_test_message" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_monthly_fee_inr" numeric(12, 2) DEFAULT '499.00' NOT NULL,
	"default_revenue_share_percent" numeric(5, 2) DEFAULT '50.00' NOT NULL,
	"status" "strategy_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "strategy_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metric_equity_inr" numeric(24, 8),
	"metric_return_pct" numeric(10, 4),
	"extra_metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_strategy_pricing_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"monthly_fee_inr_override" numeric(12, 2),
	"revenue_share_percent_override" numeric(5, 2),
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"set_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_strategy_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" "user_strategy_run_status" DEFAULT 'inactive' NOT NULL,
	"capital_to_use_inr" numeric(14, 2),
	"leverage" numeric(10, 2),
	"activated_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"last_state_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_strategy_runs_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "user_strategy_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"status" "user_strategy_subscription_status" DEFAULT 'purchased_pending_activation' NOT NULL,
	"access_valid_until" timestamp with time zone NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_activation_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid,
	"subscription_id" uuid,
	"revenue_ledger_id" uuid,
	"amount_inr" numeric(14, 2),
	"reason" text NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"amount_inr" numeric(12, 2) NOT NULL,
	"tax_amount_inr" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_description" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "payment_provider" DEFAULT 'cashfree' NOT NULL,
	"external_order_id" text,
	"external_payment_id" text,
	"amount_inr" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"subscription_id" uuid,
	"access_days_purchased" integer DEFAULT 30 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_revenue_share_ledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"week_start_date_ist" date NOT NULL,
	"week_end_date_ist" date NOT NULL,
	"amount_due_inr" numeric(14, 2) NOT NULL,
	"amount_paid_inr" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "revenue_ledger_status" DEFAULT 'unpaid' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_pnl_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"snapshot_date_ist" date NOT NULL,
	"realized_pnl_inr" numeric(14, 2) DEFAULT '0' NOT NULL,
	"unrealized_pnl_inr" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_pnl_inr" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"exchange_connection_id" uuid,
	"strategy_id" uuid NOT NULL,
	"external_trade_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"fee_inr" numeric(14, 2),
	"realized_pnl_inr" numeric(14, 2),
	"executed_at" timestamp with time zone NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"changes_json" jsonb NOT NULL,
	"status" "profile_change_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_admin_id" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"content_md" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_admin_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" text NOT NULL,
	"subject" text,
	"template_key" text,
	"status" "email_log_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" "reminder_type" NOT NULL,
	"channel" "reminder_channel" DEFAULT 'email' NOT NULL,
	"payload_json" jsonb,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "reminder_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_admin_id_admins_id_fk" FOREIGN KEY ("approved_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_otps" ADD CONSTRAINT "login_otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_connections" ADD CONSTRAINT "exchange_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_performance_snapshots" ADD CONSTRAINT "strategy_performance_snapshots_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_pricing_overrides" ADD CONSTRAINT "user_strategy_pricing_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_pricing_overrides" ADD CONSTRAINT "user_strategy_pricing_overrides_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_pricing_overrides" ADD CONSTRAINT "user_strategy_pricing_overrides_set_by_admin_id_admins_id_fk" FOREIGN KEY ("set_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD CONSTRAINT "user_strategy_runs_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_subscriptions" ADD CONSTRAINT "user_strategy_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_subscriptions" ADD CONSTRAINT "user_strategy_subscriptions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_revenue_ledger_id_weekly_revenue_share_ledgers_id_fk" FOREIGN KEY ("revenue_ledger_id") REFERENCES "public"."weekly_revenue_share_ledgers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_revenue_share_ledgers" ADD CONSTRAINT "weekly_revenue_share_ledgers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_revenue_share_ledgers" ADD CONSTRAINT "weekly_revenue_share_ledgers_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_revenue_share_ledgers" ADD CONSTRAINT "weekly_revenue_share_ledgers_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pnl_snapshots" ADD CONSTRAINT "daily_pnl_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pnl_snapshots" ADD CONSTRAINT "daily_pnl_snapshots_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_subscription_id_user_strategy_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_strategy_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_reviewed_by_admin_id_admins_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD CONSTRAINT "terms_versions_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_admin_id_admins_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admins_deleted_at_idx" ON "admins" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "users_approval_status_idx" ON "users" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "login_otps_email_expires_idx" ON "login_otps" USING btree ("email","expires_at");--> statement-breakpoint
CREATE INDEX "login_otps_user_id_idx" ON "login_otps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exchange_connections_user_id_idx" ON "exchange_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exchange_connections_user_provider_idx" ON "exchange_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "strategies_status_idx" ON "strategies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "strategies_deleted_at_idx" ON "strategies" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "strategy_perf_strategy_captured_idx" ON "strategy_performance_snapshots" USING btree ("strategy_id","captured_at");--> statement-breakpoint
CREATE INDEX "uspo_user_strategy_effective_idx" ON "user_strategy_pricing_overrides" USING btree ("user_id","strategy_id","effective_from");--> statement-breakpoint
CREATE INDEX "usr_status_idx" ON "user_strategy_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "uss_user_id_idx" ON "user_strategy_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uss_strategy_id_idx" ON "user_strategy_subscriptions" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "uss_status_access_idx" ON "user_strategy_subscriptions" USING btree ("status","access_valid_until");--> statement-breakpoint
CREATE INDEX "uss_user_strategy_idx" ON "user_strategy_subscriptions" USING btree ("user_id","strategy_id");--> statement-breakpoint
CREATE INDEX "fee_waivers_user_idx" ON "fee_waivers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fee_waivers_ledger_idx" ON "fee_waivers" USING btree ("revenue_ledger_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_user_status_idx" ON "payments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_order_uidx" ON "payments" USING btree ("provider","external_order_id") WHERE "payments"."external_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wrsl_user_status_idx" ON "weekly_revenue_share_ledgers" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "wrsl_subscription_idx" ON "weekly_revenue_share_ledgers" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wrsl_subscription_week_uidx" ON "weekly_revenue_share_ledgers" USING btree ("subscription_id","week_start_date_ist");--> statement-breakpoint
CREATE INDEX "daily_pnl_user_date_idx" ON "daily_pnl_snapshots" USING btree ("user_id","snapshot_date_ist");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pnl_subscription_date_uidx" ON "daily_pnl_snapshots" USING btree ("subscription_id","snapshot_date_ist");--> statement-breakpoint
CREATE INDEX "trades_user_executed_idx" ON "trades" USING btree ("user_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_subscription_idx" ON "trades" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "trades_strategy_idx" ON "trades" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_exchange_external_uidx" ON "trades" USING btree ("exchange_connection_id","external_trade_id") WHERE "trades"."exchange_connection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pcr_user_status_idx" ON "profile_change_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "pcr_status_idx" ON "profile_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "terms_effective_from_idx" ON "terms_versions" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_admin_idx" ON "audit_logs" USING btree ("actor_admin_id");--> statement-breakpoint
CREATE INDEX "audit_actor_user_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "email_logs_to_created_idx" ON "email_logs" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "email_logs_status_idx" ON "email_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reminders_scheduled_status_idx" ON "reminders" USING btree ("scheduled_for","status");--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id");