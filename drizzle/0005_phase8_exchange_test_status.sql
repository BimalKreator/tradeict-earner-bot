ALTER TYPE "public"."exchange_connection_test_status" ADD VALUE 'invalid_credentials';
--> statement-breakpoint
ALTER TYPE "public"."exchange_connection_test_status" ADD VALUE 'permission_denied';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_connections_user_provider_uidx" ON "exchange_connections" ("user_id", "provider") WHERE "deleted_at" IS NULL;
