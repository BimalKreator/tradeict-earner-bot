CREATE TABLE "live_position_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exchange_connection_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"local_net_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"exchange_net_qty" numeric(24, 8) DEFAULT '0' NOT NULL,
	"qty_diff" numeric(24, 8) DEFAULT '0' NOT NULL,
	"mismatch" text DEFAULT 'no' NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error_message" text,
	"raw_payload" jsonb,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_position_reconciliations" ADD CONSTRAINT "live_position_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "live_position_reconciliations" ADD CONSTRAINT "live_position_reconciliations_exchange_connection_id_exchange_connections_id_fk" FOREIGN KEY ("exchange_connection_id") REFERENCES "public"."exchange_connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "live_position_reconciliations_exchange_symbol_uidx" ON "live_position_reconciliations" USING btree ("exchange_connection_id","symbol");
--> statement-breakpoint
CREATE INDEX "live_position_reconciliations_user_idx" ON "live_position_reconciliations" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "live_position_reconciliations_reconciled_idx" ON "live_position_reconciliations" USING btree ("reconciled_at");
