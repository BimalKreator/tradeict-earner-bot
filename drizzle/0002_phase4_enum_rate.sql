CREATE TABLE "auth_rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TYPE "public"."user_approval_status_new" AS ENUM('pending_approval', 'approved', 'rejected', 'paused', 'archived');
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "approval_status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "approval_status" TYPE "public"."user_approval_status_new" USING (
	CASE "approval_status"::text
		WHEN 'pending' THEN 'pending_approval'::"public"."user_approval_status_new"
		WHEN 'approved' THEN 'approved'::"public"."user_approval_status_new"
		WHEN 'rejected' THEN 'rejected'::"public"."user_approval_status_new"
		WHEN 'paused' THEN 'paused'::"public"."user_approval_status_new"
		ELSE 'pending_approval'::"public"."user_approval_status_new"
	END
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "approval_status" SET DEFAULT 'pending_approval'::"public"."user_approval_status_new";
--> statement-breakpoint
DROP TYPE "public"."user_approval_status";
--> statement-breakpoint
ALTER TYPE "public"."user_approval_status_new" RENAME TO "user_approval_status";
