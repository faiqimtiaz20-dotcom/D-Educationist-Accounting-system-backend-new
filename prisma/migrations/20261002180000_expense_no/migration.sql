-- Add human-readable expense number (like invoice_no)

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "expense_no" VARCHAR(40);

UPDATE "expenses" e
SET "expense_no" = 'EXP-' || upper(substring(replace(e.id::text, '-', ''), 1, 8))
WHERE e."expense_no" IS NULL OR e."expense_no" = '';

ALTER TABLE "expenses" ALTER COLUMN "expense_no" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "expenses_tenant_id_expense_no_key"
  ON "expenses"("tenant_id", "expense_no");
