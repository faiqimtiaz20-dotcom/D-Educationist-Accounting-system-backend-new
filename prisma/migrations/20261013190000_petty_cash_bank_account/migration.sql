-- Cash In (imprest top-up) links to the funding bank account for sub-ledger balance.
ALTER TABLE "petty_cash_entries" ADD COLUMN "bank_account_id" UUID;

ALTER TABLE "petty_cash_entries"
  ADD CONSTRAINT "petty_cash_entries_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "petty_cash_entries_bank_account_id_idx" ON "petty_cash_entries"("bank_account_id");
