/**
 * Prisma model names (PascalCase as passed to $allOperations) that carry tenant_id.
 * Keep in sync with MT1 inventory.
 */
export const TENANTED_PRISMA_MODELS = new Set([
  'Branch',
  'User',
  'FxRate',
  'SystemSetting',
  'ExpenseCategory',
  'PettyCashCategory',
  'University',
  'SubAgent',
  'Vendor',
  'Student',
  'Invoice',
  'OtherInvoice',
  'BankAccount',
  'Receivable',
  'SubAgentCommission',
  'SubAgentPayment',
  'PettyCashEntry',
  'Expense',
  'BankTransaction',
  'Cheque',
  'ContraEntry',
  'GlAccount',
  'JournalEntry',
  'PartyLedgerEntry',
  'TaxRecord',
  'Employee',
  'PayrollRun',
  'Reimbursement',
  'Document',
  'Approval',
  'AuditLog',
  'TenantSmtpConfig',
  'Notification',
]);

export function isTenantedPrismaModel(model: string | undefined): boolean {
  return Boolean(model && TENANTED_PRISMA_MODELS.has(model));
}
