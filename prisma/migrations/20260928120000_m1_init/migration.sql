-- M1 initial schema for D' Educationist Accounting System
-- Requires PostgreSQL. Enables citext for case-insensitive emails.

CREATE EXTENSION IF NOT EXISTS citext;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('full', 'read', 'limited', 'none');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('Applied', 'Offer', 'Visa', 'Enrolled', 'Deferred', 'Withdrawn');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('Draft', 'Sent', 'PartiallyReceived', 'FullyReceived', 'Closed');

-- CreateEnum
CREATE TYPE "OtherInvoiceStatus" AS ENUM ('Draft', 'Sent', 'Paid', 'Closed');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('Matched', 'Unmatched');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('pending', 'allocated');

-- CreateEnum
CREATE TYPE "SubAgentCommissionStatus" AS ENUM ('Pending', 'Partial', 'Paid');

-- CreateEnum
CREATE TYPE "PettyCashEntryType" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('Draft', 'Processed', 'Paid');

-- CreateEnum
CREATE TYPE "PayrollSource" AS ENUM ('Internal', 'Uploaded');

-- CreateEnum
CREATE TYPE "ReimbursementType" AS ENUM ('Travel', 'Fuel', 'Reimbursement', 'AdvanceSettlement');

-- CreateEnum
CREATE TYPE "BankTransactionType" AS ENUM ('deposit', 'withdrawal', 'transfer');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('Issued', 'Cleared', 'Bounced');

-- CreateEnum
CREATE TYPE "GlAccountType" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "JournalSourceType" AS ENUM ('Manual', 'Invoice', 'Receivable', 'Expense', 'PettyCash', 'Payroll', 'Reversal', 'OtherInvoice', 'SubAgentPayment', 'Contra');

-- CreateEnum
CREATE TYPE "ContraEntryType" AS ENUM ('CashBank', 'BankBank', 'CashCash');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('WhtReceivable', 'WhtPayable', 'GstInput', 'GstOutput', 'SrbSst', 'SalaryTax');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('student', 'vendor', 'sub_agent');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('Invoice', 'Receipt', 'Bill', 'Contract', 'Agreement');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('Expense', 'SubAgentPayout', 'Journal', 'Refund', 'Reimbursement', 'Payroll');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'SEND', 'CLOSE', 'PROCESS', 'PAY', 'ALLOCATE', 'REVERSE', 'IMPORT', 'EXPORT', 'OTHER');

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "is_head_office" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_module_permissions" (
    "role_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "level" "PermissionLevel" NOT NULL,

    CONSTRAINT "role_module_permissions_pkey" PRIMARY KEY ("role_id","module_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "role_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" VARCHAR(64),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "symbol" VARCHAR(8),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "rate_to_pkr" DECIMAL(18,6) NOT NULL,
    "effective_date" DATE NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "gl_account_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petty_cash_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "petty_cash_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_modes" (
    "code" VARCHAR(30) NOT NULL,

    CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" VARCHAR(2) NOT NULL,
    "name" VARCHAR(80) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "universities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "country_code" VARCHAR(2),
    "country_name" VARCHAR(80) NOT NULL,
    "default_commission_rate" DECIMAL(8,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_agents" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "ntn" VARCHAR(40),
    "email" CITEXT,
    "contact" VARCHAR(40),
    "account_title" VARCHAR(160),
    "iban" VARCHAR(34),
    "account_no" VARCHAR(40),
    "default_rate_percent" DECIMAL(8,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sub_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "ntn" VARCHAR(40),
    "contact" VARCHAR(40),
    "email" CITEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "student_code" VARCHAR(40) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "cnic_passport" VARCHAR(40) NOT NULL,
    "contact" VARCHAR(40),
    "email" CITEXT,
    "branch_id" UUID NOT NULL,
    "counsellor_id" UUID NOT NULL,
    "country" VARCHAR(80) NOT NULL,
    "university_id" UUID NOT NULL,
    "course" VARCHAR(200) NOT NULL,
    "intake" VARCHAR(40) NOT NULL,
    "student_group" VARCHAR(80),
    "application_status" "ApplicationStatus" NOT NULL,
    "sub_agent_id" UUID,
    "tuition_fee" DECIMAL(18,2) NOT NULL,
    "scholarship" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expected_commission_rate" DECIMAL(8,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_history" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoice_no" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "university_id" UUID,
    "invoice_date" DATE NOT NULL,
    "po_number" VARCHAR(60),
    "currency_code" CHAR(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'Draft',
    "exchange_rate" DECIMAL(18,6),
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "tuition_fee" DECIMAL(18,2) NOT NULL,
    "scholarship" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commission_rate" DECIMAL(8,4) NOT NULL,
    "bonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commission_amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_invoices" (
    "id" UUID NOT NULL,
    "invoice_no" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_date" DATE NOT NULL,
    "bill_to" VARCHAR(200) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "status" "OtherInvoiceStatus" NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "other_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_invoice_lines" (
    "id" UUID NOT NULL,
    "other_invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "other_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "bank_name" VARCHAR(120) NOT NULL,
    "account_no" VARCHAR(40) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "opening_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "receipt_no" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID,
    "bank_account_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "amount_received" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "amount_pkr_gross" DECIMAL(18,2) NOT NULL,
    "wht_amount_pkr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_pkr_net" DECIMAL(18,2) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'Unmatched',
    "is_partial" BOOLEAN NOT NULL DEFAULT false,
    "is_bulk_remittance" BOOLEAN NOT NULL DEFAULT false,
    "allocation_status" "AllocationStatus",
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_allocations" (
    "id" UUID NOT NULL,
    "receivable_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "allocated_amount_pkr" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receivable_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_agent_commissions" (
    "id" UUID NOT NULL,
    "sub_agent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "gross_fee" DECIMAL(18,2) NOT NULL,
    "rate_given" DECIMAL(8,4) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "follow_on_bonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency_code" CHAR(3) NOT NULL,
    "payable_pkr_gross" DECIMAL(18,2) NOT NULL,
    "wht_pkr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payable_pkr_net" DECIMAL(18,2) NOT NULL,
    "status" "SubAgentCommissionStatus" NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_agent_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_agent_payments" (
    "id" UUID NOT NULL,
    "commission_id" UUID NOT NULL,
    "sub_agent_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "cheque_id" UUID,
    "cheque_no" VARCHAR(40),
    "amount_pkr" DECIMAL(18,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'PKR',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_agent_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petty_cash_entries" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "entry_type" "PettyCashEntryType" NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "sales_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "srb_sst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "income_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "vendor_id" UUID,
    "vendor_name" VARCHAR(160),
    "category_id" UUID NOT NULL,
    "expense_date" DATE NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "sales_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "srb_sst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "income_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "payment_mode" VARCHAR(30) NOT NULL,
    "cheque_id" UUID,
    "bank_account_id" UUID,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "txn_date" DATE NOT NULL,
    "txn_type" "BankTransactionType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "counterparty_bank_account_id" UUID,
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'Unmatched',
    "source_type" VARCHAR(40),
    "source_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" UUID NOT NULL,
    "cheque_no" VARCHAR(40) NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payee" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "issue_date" DATE NOT NULL,
    "status" "ChequeStatus" NOT NULL DEFAULT 'Issued',
    "cleared_date" DATE,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contra_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "contra_type" "ContraEntryType" NOT NULL,
    "from_bank_account_id" UUID,
    "to_bank_account_id" UUID,
    "from_is_cash" BOOLEAN NOT NULL DEFAULT false,
    "to_is_cash" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(18,2) NOT NULL,
    "branch_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contra_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "account_type" "GlAccountType" NOT NULL,
    "parent_id" UUID,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "entry_no" VARCHAR(40) NOT NULL,
    "entry_date" DATE NOT NULL,
    "branch_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "source_type" "JournalSourceType",
    "source_id" UUID,
    "is_auto_posted" BOOLEAN NOT NULL DEFAULT false,
    "posted_at" TIMESTAMP(3),
    "created_by" UUID,
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_ledger_entries" (
    "id" UUID NOT NULL,
    "party_type" "PartyType" NOT NULL,
    "party_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reference" VARCHAR(80),
    "journal_entry_id" UUID,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_records" (
    "id" UUID NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "period" CHAR(7) NOT NULL,
    "branch_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source_type" VARCHAR(40),
    "source_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" VARCHAR(160) NOT NULL,
    "branch_id" UUID NOT NULL,
    "designation" VARCHAR(80) NOT NULL,
    "basic_salary" DECIMAL(18,2) NOT NULL,
    "allowances" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "email" CITEXT,
    "bank_account" VARCHAR(60),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'Draft',
    "run_date" DATE NOT NULL,
    "paid_date" DATE,
    "source" "PayrollSource" NOT NULL DEFAULT 'Internal',
    "total_gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_reimbursements" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "processed_by" UUID,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "basic_salary" DECIMAL(18,2) NOT NULL,
    "allowances" DECIMAL(18,2) NOT NULL,
    "gross_salary" DECIMAL(18,2) NOT NULL,
    "salary_tax" DECIMAL(18,2) NOT NULL,
    "net_salary" DECIMAL(18,2) NOT NULL,
    "reimbursements" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_payable" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reimbursements" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "reimbursement_type" "ReimbursementType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reimbursement_date" DATE NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "description" TEXT,
    "requested_by" UUID,
    "payroll_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reimbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_tax_slabs" (
    "id" UUID NOT NULL,
    "min_annual" DECIMAL(18,2) NOT NULL,
    "max_annual" DECIMAL(18,2),
    "rate_percent" DECIMAL(8,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "salary_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "linked_type" VARCHAR(40) NOT NULL,
    "linked_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" VARCHAR(100),
    "size_bytes" BIGINT,
    "uploaded_by" UUID,
    "upload_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "approval_type" "ApprovalType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "branch_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "request_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" "AuditAction" NOT NULL,
    "module" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80),
    "entity_id" UUID,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "modules_code_key" ON "modules"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_currency_code_effective_date_key" ON "fx_rates"("currency_code", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_categories_name_key" ON "petty_cash_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "countries"("name");

-- CreateIndex
CREATE INDEX "universities_country_name_idx" ON "universities"("country_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_student_code_key" ON "students"("student_code");

-- CreateIndex
CREATE INDEX "students_branch_id_application_status_idx" ON "students"("branch_id", "application_status");

-- CreateIndex
CREATE INDEX "students_counsellor_id_idx" ON "students"("counsellor_id");

-- CreateIndex
CREATE INDEX "students_university_id_idx" ON "students"("university_id");

-- CreateIndex
CREATE INDEX "student_status_history_student_id_changed_at_idx" ON "student_status_history"("student_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_no_key" ON "invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "invoices_branch_id_status_invoice_date_idx" ON "invoices"("branch_id", "status", "invoice_date");

-- CreateIndex
CREATE INDEX "invoice_lines_student_id_idx" ON "invoice_lines"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_no_key" ON "invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_student_id_key" ON "invoice_lines"("invoice_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "other_invoices_invoice_no_key" ON "other_invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "other_invoices_branch_id_status_invoice_date_idx" ON "other_invoices"("branch_id", "status", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "other_invoice_lines_other_invoice_id_line_no_key" ON "other_invoice_lines"("other_invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "bank_accounts_branch_id_idx" ON "bank_accounts"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_receipt_no_key" ON "receivables"("receipt_no");

-- CreateIndex
CREATE INDEX "receivables_branch_id_receipt_date_idx" ON "receivables"("branch_id", "receipt_date");

-- CreateIndex
CREATE INDEX "receivable_allocations_invoice_id_idx" ON "receivable_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_allocations_receivable_id_invoice_id_key" ON "receivable_allocations"("receivable_id", "invoice_id");

-- CreateIndex
CREATE INDEX "sub_agent_commissions_sub_agent_id_status_idx" ON "sub_agent_commissions"("sub_agent_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sub_agent_commissions_student_id_invoice_id_sub_agent_id_key" ON "sub_agent_commissions"("student_id", "invoice_id", "sub_agent_id");

-- CreateIndex
CREATE INDEX "sub_agent_payments_commission_id_idx" ON "sub_agent_payments"("commission_id");

-- CreateIndex
CREATE INDEX "petty_cash_entries_branch_id_entry_date_idx" ON "petty_cash_entries"("branch_id", "entry_date");

-- CreateIndex
CREATE INDEX "expenses_branch_id_approval_status_expense_date_idx" ON "expenses"("branch_id", "approval_status", "expense_date");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_txn_date_idx" ON "bank_transactions"("bank_account_id", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_bank_account_id_cheque_no_key" ON "cheques"("bank_account_id", "cheque_no");

-- CreateIndex
CREATE INDEX "contra_entries_branch_id_entry_date_idx" ON "contra_entries"("branch_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "gl_accounts_code_key" ON "gl_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_no_key" ON "journal_entries"("entry_no");

-- CreateIndex
CREATE INDEX "journal_entries_branch_id_entry_date_idx" ON "journal_entries"("branch_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_source_type_source_id_key" ON "journal_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_lines_gl_account_id_idx" ON "journal_lines"("gl_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journal_entry_id_line_no_key" ON "journal_lines"("journal_entry_id", "line_no");

-- CreateIndex
CREATE INDEX "party_ledger_entries_party_type_party_id_entry_date_idx" ON "party_ledger_entries"("party_type", "party_id", "entry_date");

-- CreateIndex
CREATE INDEX "party_ledger_entries_branch_id_idx" ON "party_ledger_entries"("branch_id");

-- CreateIndex
CREATE INDEX "tax_records_branch_id_period_idx" ON "tax_records"("branch_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "tax_records_tax_type_period_branch_id_source_type_source_id_key" ON "tax_records"("tax_type", "period", "branch_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_branch_id_idx" ON "employees"("branch_id");

-- CreateIndex
CREATE INDEX "payroll_runs_branch_id_period_idx" ON "payroll_runs"("branch_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_branch_id_period_source_key" ON "payroll_runs"("branch_id", "period", "source");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_payroll_run_id_employee_id_key" ON "payroll_lines"("payroll_run_id", "employee_id");

-- CreateIndex
CREATE INDEX "reimbursements_branch_id_status_idx" ON "reimbursements"("branch_id", "status");

-- CreateIndex
CREATE INDEX "documents_linked_type_linked_id_idx" ON "documents"("linked_type", "linked_id");

-- CreateIndex
CREATE INDEX "approvals_status_branch_id_idx" ON "approvals"("status", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_source_type_source_id_key" ON "approvals"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_module_user_id_idx" ON "audit_logs"("module", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "role_module_permissions" ADD CONSTRAINT "role_module_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_module_permissions" ADD CONSTRAINT "role_module_permissions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universities" ADD CONSTRAINT "universities_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universities" ADD CONSTRAINT "universities_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_counsellor_id_fkey" FOREIGN KEY ("counsellor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_sub_agent_id_fkey" FOREIGN KEY ("sub_agent_id") REFERENCES "sub_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoices" ADD CONSTRAINT "other_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoices" ADD CONSTRAINT "other_invoices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoices" ADD CONSTRAINT "other_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoice_lines" ADD CONSTRAINT "other_invoice_lines_other_invoice_id_fkey" FOREIGN KEY ("other_invoice_id") REFERENCES "other_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_allocations" ADD CONSTRAINT "receivable_allocations_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_allocations" ADD CONSTRAINT "receivable_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_allocations" ADD CONSTRAINT "receivable_allocations_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_commissions" ADD CONSTRAINT "sub_agent_commissions_sub_agent_id_fkey" FOREIGN KEY ("sub_agent_id") REFERENCES "sub_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_commissions" ADD CONSTRAINT "sub_agent_commissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_commissions" ADD CONSTRAINT "sub_agent_commissions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_commissions" ADD CONSTRAINT "sub_agent_commissions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_commissions" ADD CONSTRAINT "sub_agent_commissions_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "sub_agent_commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_sub_agent_id_fkey" FOREIGN KEY ("sub_agent_id") REFERENCES "sub_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_payments" ADD CONSTRAINT "sub_agent_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "petty_cash_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_mode_fkey" FOREIGN KEY ("payment_mode") REFERENCES "payment_modes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_counterparty_bank_account_id_fkey" FOREIGN KEY ("counterparty_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_from_bank_account_id_fkey" FOREIGN KEY ("from_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_to_bank_account_id_fkey" FOREIGN KEY ("to_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_ledger_entries" ADD CONSTRAINT "party_ledger_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_ledger_entries" ADD CONSTRAINT "party_ledger_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_records" ADD CONSTRAINT "tax_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

