DROP INDEX IF EXISTS "exchange_connections_user_provider_uidx";--> statement-breakpoint
ALTER TABLE "exchange_connections" ADD COLUMN "account_label" text DEFAULT 'Account 1' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_connections_user_provider_label_uidx" ON "exchange_connections" USING btree ("user_id","provider","account_label") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD COLUMN "primary_exchange_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD COLUMN "secondary_exchange_connection_id" uuid;--> statement-breakpoint
UPDATE "user_strategy_runs" usr
SET "primary_exchange_connection_id" = sub.id
FROM (
  SELECT DISTINCT ON (ec."user_id") ec."id", ec."user_id"
  FROM "exchange_connections" ec
  WHERE ec."deleted_at" IS NULL AND ec."provider" = 'delta_india'
  ORDER BY ec."user_id", ec."updated_at" DESC
) sub
INNER JOIN "user_strategy_subscriptions" uss ON uss."user_id" = sub."user_id"
WHERE usr."subscription_id" = uss."id" AND usr."primary_exchange_connection_id" IS NULL;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD CONSTRAINT "user_strategy_runs_primary_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("primary_exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_strategy_runs" ADD CONSTRAINT "user_strategy_runs_secondary_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("secondary_exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "bot_orders_correlation_subscription_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "bot_orders_correlation_subscription_exchange_uidx" ON "bot_orders" USING btree ("correlation_id","subscription_id","exchange_connection_id") WHERE "correlation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "exchange_connection_id" uuid;--> statement-breakpoint
UPDATE "bot_positions" bp
SET "exchange_connection_id" = s."ec_id"
FROM (
  SELECT DISTINCT ON (bo."subscription_id", bo."symbol")
    bo."subscription_id",
    bo."symbol",
    bo."exchange_connection_id" AS "ec_id"
  FROM "bot_orders" bo
  WHERE bo."trade_source" = 'bot'
  ORDER BY bo."subscription_id", bo."symbol", bo."updated_at" DESC
) s
WHERE bp."subscription_id" = s."subscription_id"
  AND bp."symbol" = s."symbol"
  AND bp."exchange_connection_id" IS NULL;--> statement-breakpoint
UPDATE "bot_positions" bp
SET "exchange_connection_id" = ec."id"
FROM "exchange_connections" ec
WHERE ec."user_id" = bp."user_id"
  AND ec."provider" = 'delta_india'
  AND ec."deleted_at" IS NULL
  AND bp."exchange_connection_id" IS NULL
  AND ec."id" = (
    SELECT ec2."id" FROM "exchange_connections" ec2
    WHERE ec2."user_id" = bp."user_id"
      AND ec2."provider" = 'delta_india'
      AND ec2."deleted_at" IS NULL
    ORDER BY ec2."updated_at" DESC
    LIMIT 1
  );--> statement-breakpoint
DELETE FROM "bot_positions" WHERE "exchange_connection_id" IS NULL;--> statement-breakpoint
ALTER TABLE "bot_positions" ALTER COLUMN "exchange_connection_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "bot_positions_subscription_symbol_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "bot_positions_subscription_symbol_exchange_uidx" ON "bot_positions" USING btree ("subscription_id","symbol","exchange_connection_id");--> statement-breakpoint
CREATE INDEX "bot_positions_exchange_idx" ON "bot_positions" USING btree ("exchange_connection_id");
