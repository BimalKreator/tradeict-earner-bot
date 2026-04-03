CREATE TYPE "public"."notification_log_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" "notification_log_status" NOT NULL,
	"metadata" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_logs_user_sent_idx" ON "notification_logs" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "notification_logs_type_sent_idx" ON "notification_logs" USING btree ("type","sent_at");
