CREATE TYPE "public"."terms_document_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "terms_and_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_name" text NOT NULL,
	"content" text NOT NULL,
	"status" "terms_document_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "tac_status_idx" ON "terms_and_conditions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tac_updated_at_idx" ON "terms_and_conditions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tac_single_published_uidx" ON "terms_and_conditions" USING btree ("status") WHERE status = 'published';--> statement-breakpoint
CREATE TABLE "user_accepted_terms" (
	"user_id" uuid NOT NULL,
	"terms_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_accepted_terms_user_id_terms_id_pk" PRIMARY KEY("user_id","terms_id")
);--> statement-breakpoint
ALTER TABLE "user_accepted_terms" ADD CONSTRAINT "user_accepted_terms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accepted_terms" ADD CONSTRAINT "user_accepted_terms_terms_id_terms_and_conditions_id_fk" FOREIGN KEY ("terms_id") REFERENCES "public"."terms_and_conditions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uat_user_idx" ON "user_accepted_terms" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uat_terms_idx" ON "user_accepted_terms" USING btree ("terms_id");
