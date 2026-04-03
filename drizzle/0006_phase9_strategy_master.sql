CREATE TYPE "public"."strategy_visibility" AS ENUM('public', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."strategy_risk_label" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "visibility" "strategy_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "risk_label" "strategy_risk_label" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "recommended_capital_inr" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "max_leverage" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "performance_chart_json" jsonb;--> statement-breakpoint
UPDATE "strategies" SET "visibility" = 'hidden' WHERE "status" = 'hidden';--> statement-breakpoint
UPDATE "strategies" SET "status" = 'paused' WHERE "status" = 'hidden';--> statement-breakpoint
CREATE INDEX "strategies_visibility_idx" ON "strategies" USING btree ("visibility");--> statement-breakpoint
