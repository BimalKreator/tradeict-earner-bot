ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "revenue_share_ledger_id" uuid;

DO $$
BEGIN
  ALTER TABLE "payments"
  ADD CONSTRAINT "payments_revenue_share_ledger_id_weekly_revenue_share_ledgers_id_fk"
  FOREIGN KEY ("revenue_share_ledger_id") REFERENCES "public"."weekly_revenue_share_ledgers"("id")
  ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "payments_revenue_ledger_idx" ON "payments" ("revenue_share_ledger_id");
