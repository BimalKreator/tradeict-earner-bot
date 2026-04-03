-- Persist the revenue-share % used when the weekly ledger row was computed (historical accuracy).
ALTER TABLE "weekly_revenue_share_ledgers"
ADD COLUMN IF NOT EXISTS "revenue_share_percent_applied" numeric(5, 2);

UPDATE "weekly_revenue_share_ledgers"
SET "revenue_share_percent_applied" = 0
WHERE "revenue_share_percent_applied" IS NULL;

ALTER TABLE "weekly_revenue_share_ledgers"
ALTER COLUMN "revenue_share_percent_applied" SET DEFAULT 0;

ALTER TABLE "weekly_revenue_share_ledgers"
ALTER COLUMN "revenue_share_percent_applied" SET NOT NULL;
