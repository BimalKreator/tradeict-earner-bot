ALTER TABLE "bot_orders" ADD COLUMN "realized_pnl_inr" numeric(14, 2);--> statement-breakpoint
CREATE INDEX "bot_orders_user_pnl_day_idx" ON "bot_orders" USING btree ("user_id", "last_synced_at");
