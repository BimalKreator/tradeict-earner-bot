CREATE TABLE "connectivity_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text DEFAULT 'phase1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
