CREATE TYPE "public"."bot_trade_source" AS ENUM('bot', 'manual');--> statement-breakpoint
CREATE TABLE "bot_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_order_id" uuid NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "bot_orders" ADD COLUMN "trade_source" "bot_trade_source" DEFAULT 'bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD COLUMN "venue_order_state" text;--> statement-breakpoint
ALTER TABLE "bot_orders" ADD COLUMN "fill_price" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "bot_orders" ADD COLUMN "filled_qty" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "bot_execution_logs" ADD CONSTRAINT "bot_execution_logs_bot_order_id_bot_orders_id_fk" FOREIGN KEY ("bot_order_id") REFERENCES "public"."bot_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_execution_logs_order_created_idx" ON "bot_execution_logs" USING btree ("bot_order_id","created_at");
