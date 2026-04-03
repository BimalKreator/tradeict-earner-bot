ALTER TYPE "public"."payment_status" ADD VALUE 'created';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "strategy_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_strategy_id_idx" ON "payments" USING btree ("strategy_id");--> statement-breakpoint
