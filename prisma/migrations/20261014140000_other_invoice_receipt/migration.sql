-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'OtherInvoiceReceipt';

-- CreateTable
CREATE TABLE "other_invoice_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001',
    "receipt_no" VARCHAR(40) NOT NULL,
    "other_invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "amount_received" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "amount_pkr" DECIMAL(18,2) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "other_invoice_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "other_invoice_receipts_tenant_id_receipt_no_key" ON "other_invoice_receipts"("tenant_id", "receipt_no");

-- CreateIndex
CREATE INDEX "other_invoice_receipts_tenant_id_idx" ON "other_invoice_receipts"("tenant_id");

-- CreateIndex
CREATE INDEX "other_invoice_receipts_other_invoice_id_idx" ON "other_invoice_receipts"("other_invoice_id");

-- CreateIndex
CREATE INDEX "other_invoice_receipts_branch_id_receipt_date_idx" ON "other_invoice_receipts"("branch_id", "receipt_date");

-- AddForeignKey
ALTER TABLE "other_invoice_receipts" ADD CONSTRAINT "other_invoice_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoice_receipts" ADD CONSTRAINT "other_invoice_receipts_other_invoice_id_fkey" FOREIGN KEY ("other_invoice_id") REFERENCES "other_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoice_receipts" ADD CONSTRAINT "other_invoice_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoice_receipts" ADD CONSTRAINT "other_invoice_receipts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoice_receipts" ADD CONSTRAINT "other_invoice_receipts_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_invoice_receipts" ADD CONSTRAINT "other_invoice_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
