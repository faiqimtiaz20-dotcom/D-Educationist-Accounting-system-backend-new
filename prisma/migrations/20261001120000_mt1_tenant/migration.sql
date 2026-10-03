-- MT1: multi-tenant foundation — Tenant table + tenant_id backfill
-- Default tenant UUID is fixed for stable seeds/parity defaults.
-- Behaviour remains single-tenant until MT2/MT3 enforce scope in the API.

CREATE TYPE "TenantStatus" AS ENUM ('Active', 'Suspended', 'Trial');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- Fixed id for current D' Educationist org (single-tenant backfill)
INSERT INTO "tenants" ("id", "code", "name", "status", "created_at", "updated_at")
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'DED',
  'D'' Educationist',
  'Active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Helper: add nullable column, backfill, set NOT NULL + FK + index
-- (users.tenant_id stays nullable for future CRM_ADMIN)

ALTER TABLE "branches" ADD COLUMN "tenant_id" UUID;
UPDATE "branches" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "branches" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "branches" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");
DROP INDEX IF EXISTS "branches_code_key";
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

ALTER TABLE "users" ADD COLUMN "tenant_id" UUID;
UPDATE "users" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
-- keep nullable for platform CRM users (MT2); default helps MT1 creates
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

ALTER TABLE "fx_rates" ADD COLUMN "tenant_id" UUID;
UPDATE "fx_rates" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "fx_rates" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "fx_rates" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "fx_rates_tenant_id_idx" ON "fx_rates"("tenant_id");
DROP INDEX IF EXISTS "fx_rates_currency_code_effective_date_key";
CREATE UNIQUE INDEX "fx_rates_tenant_id_currency_code_effective_date_key" ON "fx_rates"("tenant_id", "currency_code", "effective_date");

ALTER TABLE "system_settings" ADD COLUMN "tenant_id" UUID;
UPDATE "system_settings" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "system_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "system_settings" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "system_settings_tenant_id_idx" ON "system_settings"("tenant_id");
DROP INDEX IF EXISTS "system_settings_key_key";
CREATE UNIQUE INDEX "system_settings_tenant_id_key_key" ON "system_settings"("tenant_id", "key");

ALTER TABLE "expense_categories" ADD COLUMN "tenant_id" UUID;
UPDATE "expense_categories" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "expense_categories" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "expense_categories" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "expense_categories_tenant_id_idx" ON "expense_categories"("tenant_id");
DROP INDEX IF EXISTS "expense_categories_name_key";
CREATE UNIQUE INDEX "expense_categories_tenant_id_name_key" ON "expense_categories"("tenant_id", "name");

ALTER TABLE "petty_cash_categories" ADD COLUMN "tenant_id" UUID;
UPDATE "petty_cash_categories" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "petty_cash_categories" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "petty_cash_categories" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "petty_cash_categories" ADD CONSTRAINT "petty_cash_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "petty_cash_categories_tenant_id_idx" ON "petty_cash_categories"("tenant_id");
DROP INDEX IF EXISTS "petty_cash_categories_name_key";
CREATE UNIQUE INDEX "petty_cash_categories_tenant_id_name_key" ON "petty_cash_categories"("tenant_id", "name");

ALTER TABLE "universities" ADD COLUMN "tenant_id" UUID;
UPDATE "universities" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "universities" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "universities" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "universities" ADD CONSTRAINT "universities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "universities_tenant_id_idx" ON "universities"("tenant_id");

ALTER TABLE "sub_agents" ADD COLUMN "tenant_id" UUID;
UPDATE "sub_agents" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "sub_agents" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "sub_agents" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "sub_agents" ADD CONSTRAINT "sub_agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "sub_agents_tenant_id_idx" ON "sub_agents"("tenant_id");

ALTER TABLE "vendors" ADD COLUMN "tenant_id" UUID;
UPDATE "vendors" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "vendors" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "vendors" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "vendors_tenant_id_idx" ON "vendors"("tenant_id");

ALTER TABLE "students" ADD COLUMN "tenant_id" UUID;
UPDATE "students" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "students" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "students" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "students_tenant_id_idx" ON "students"("tenant_id");
DROP INDEX IF EXISTS "students_student_code_key";
CREATE UNIQUE INDEX "students_tenant_id_student_code_key" ON "students"("tenant_id", "student_code");

ALTER TABLE "invoices" ADD COLUMN "tenant_id" UUID;
UPDATE "invoices" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "invoices" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "invoices" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");
DROP INDEX IF EXISTS "invoices_invoice_no_key";
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_no_key" ON "invoices"("tenant_id", "invoice_no");

ALTER TABLE "other_invoices" ADD COLUMN "tenant_id" UUID;
UPDATE "other_invoices" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "other_invoices" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "other_invoices" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "other_invoices" ADD CONSTRAINT "other_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "other_invoices_tenant_id_idx" ON "other_invoices"("tenant_id");
DROP INDEX IF EXISTS "other_invoices_invoice_no_key";
CREATE UNIQUE INDEX "other_invoices_tenant_id_invoice_no_key" ON "other_invoices"("tenant_id", "invoice_no");

ALTER TABLE "bank_accounts" ADD COLUMN "tenant_id" UUID;
UPDATE "bank_accounts" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "bank_accounts" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "bank_accounts" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bank_accounts_tenant_id_idx" ON "bank_accounts"("tenant_id");

ALTER TABLE "receivables" ADD COLUMN "tenant_id" UUID;
UPDATE "receivables" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "receivables" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "receivables" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "receivables_tenant_id_idx" ON "receivables"("tenant_id");
DROP INDEX IF EXISTS "receivables_receipt_no_key";
CREATE UNIQUE INDEX "receivables_tenant_id_receipt_no_key" ON "receivables"("tenant_id", "receipt_no");

ALTER TABLE "sub_agent_commissions" ADD COLUMN "tenant_id" UUID;
UPDATE "sub_agent_commissions" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "sub_agent_commissions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "sub_agent_commissions" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "sub_agent_commissions" ADD CONSTRAINT "sub_agent_commissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "sub_agent_commissions_tenant_id_idx" ON "sub_agent_commissions"("tenant_id");

ALTER TABLE "sub_agent_payments" ADD COLUMN "tenant_id" UUID;
UPDATE "sub_agent_payments" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "sub_agent_payments" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "sub_agent_payments" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "sub_agent_payments_tenant_id_idx" ON "sub_agent_payments"("tenant_id");

ALTER TABLE "petty_cash_entries" ADD COLUMN "tenant_id" UUID;
UPDATE "petty_cash_entries" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "petty_cash_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "petty_cash_entries" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "petty_cash_entries_tenant_id_idx" ON "petty_cash_entries"("tenant_id");

ALTER TABLE "expenses" ADD COLUMN "tenant_id" UUID;
UPDATE "expenses" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "expenses" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "expenses_tenant_id_idx" ON "expenses"("tenant_id");

ALTER TABLE "bank_transactions" ADD COLUMN "tenant_id" UUID;
UPDATE "bank_transactions" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "bank_transactions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "bank_transactions" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bank_transactions_tenant_id_idx" ON "bank_transactions"("tenant_id");

ALTER TABLE "cheques" ADD COLUMN "tenant_id" UUID;
UPDATE "cheques" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "cheques" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "cheques" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "cheques_tenant_id_idx" ON "cheques"("tenant_id");

ALTER TABLE "contra_entries" ADD COLUMN "tenant_id" UUID;
UPDATE "contra_entries" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "contra_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "contra_entries" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "contra_entries_tenant_id_idx" ON "contra_entries"("tenant_id");

ALTER TABLE "gl_accounts" ADD COLUMN "tenant_id" UUID;
UPDATE "gl_accounts" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "gl_accounts" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "gl_accounts" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "gl_accounts_tenant_id_idx" ON "gl_accounts"("tenant_id");
DROP INDEX IF EXISTS "gl_accounts_code_key";
CREATE UNIQUE INDEX "gl_accounts_tenant_id_code_key" ON "gl_accounts"("tenant_id", "code");

ALTER TABLE "journal_entries" ADD COLUMN "tenant_id" UUID;
UPDATE "journal_entries" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "journal_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "journal_entries" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "journal_entries_tenant_id_idx" ON "journal_entries"("tenant_id");
DROP INDEX IF EXISTS "journal_entries_entry_no_key";
CREATE UNIQUE INDEX "journal_entries_tenant_id_entry_no_key" ON "journal_entries"("tenant_id", "entry_no");

ALTER TABLE "party_ledger_entries" ADD COLUMN "tenant_id" UUID;
UPDATE "party_ledger_entries" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "party_ledger_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "party_ledger_entries" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "party_ledger_entries" ADD CONSTRAINT "party_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "party_ledger_entries_tenant_id_idx" ON "party_ledger_entries"("tenant_id");

ALTER TABLE "tax_records" ADD COLUMN "tenant_id" UUID;
UPDATE "tax_records" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "tax_records" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "tax_records" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "tax_records" ADD CONSTRAINT "tax_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tax_records_tenant_id_idx" ON "tax_records"("tenant_id");

ALTER TABLE "employees" ADD COLUMN "tenant_id" UUID;
UPDATE "employees" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "employees" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "employees" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "employees_tenant_id_idx" ON "employees"("tenant_id");

ALTER TABLE "payroll_runs" ADD COLUMN "tenant_id" UUID;
UPDATE "payroll_runs" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "payroll_runs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "payroll_runs" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payroll_runs_tenant_id_idx" ON "payroll_runs"("tenant_id");

ALTER TABLE "reimbursements" ADD COLUMN "tenant_id" UUID;
UPDATE "reimbursements" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "reimbursements" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "reimbursements" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "reimbursements_tenant_id_idx" ON "reimbursements"("tenant_id");

ALTER TABLE "documents" ADD COLUMN "tenant_id" UUID;
UPDATE "documents" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "documents" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "documents" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

ALTER TABLE "approvals" ADD COLUMN "tenant_id" UUID;
UPDATE "approvals" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "approvals" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "approvals" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "approvals_tenant_id_idx" ON "approvals"("tenant_id");

ALTER TABLE "audit_logs" ADD COLUMN "tenant_id" UUID;
UPDATE "audit_logs" SET "tenant_id" = 'a0000000-0000-4000-8000-000000000001';
-- nullable for future platform-level CRM audit; default for MT1 app writes
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" SET DEFAULT 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");
