ALTER TABLE "weekly_revenue_share_ledgers"
ADD COLUMN IF NOT EXISTS "admin_notes" text;

ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "admin_notes" text;
