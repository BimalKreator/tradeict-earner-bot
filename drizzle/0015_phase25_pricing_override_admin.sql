ALTER TABLE "user_strategy_pricing_overrides" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "user_strategy_pricing_overrides" ADD COLUMN IF NOT EXISTS "admin_notes" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uspo_user_strategy_active_from_idx" ON "user_strategy_pricing_overrides" USING btree ("user_id","strategy_id","is_active","effective_from");
