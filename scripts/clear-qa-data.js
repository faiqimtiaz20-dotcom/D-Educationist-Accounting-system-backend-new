const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Delete all QA / seed transactional data from the local DB.
 * Keeps: roles, modules, permissions, currencies, countries, payment modes,
 * salary tax slabs, tenants, branches, and users (so you can still log in).
 */
async function main() {
  console.log('Truncating QA transactional tables...');

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "notifications",
      "approvals",
      "documents",
      "audit_logs",
      "receivable_allocations",
      "receivables",
      "invoice_lines",
      "invoices",
      "other_invoice_lines",
      "other_invoices",
      "sub_agent_payments",
      "sub_agent_commissions",
      "party_ledger_entries",
      "journal_lines",
      "journal_entries",
      "contra_entries",
      "cheques",
      "bank_transactions",
      "expenses",
      "petty_cash_entries",
      "tax_records",
      "reimbursements",
      "payroll_lines",
      "payroll_runs",
      "employees",
      "student_status_history",
      "students",
      "bank_accounts",
      "vendors",
      "sub_agents",
      "universities",
      "gl_accounts",
      "fx_rates",
      "expense_categories",
      "petty_cash_categories",
      "tenant_smtp_configs",
      "system_settings",
      "refresh_tokens",
      "user_branch_access"
    RESTART IDENTITY CASCADE;
  `);

  const counts = {
    students: await prisma.student.count(),
    invoices: await prisma.invoice.count(),
    receivables: await prisma.receivable.count(),
    expenses: await prisma.expense.count(),
    journals: await prisma.journalEntry.count(),
    notifications: await prisma.notification.count(),
    approvals: await prisma.approval.count(),
    universities: await prisma.university.count(),
    glAccounts: await prisma.glAccount.count(),
    users: await prisma.user.count(),
    tenants: await prisma.tenant.count(),
    branches: await prisma.branch.count(),
  };

  console.log('Remaining counts:', counts);
  console.log('Kept: tenants, branches, users, roles/modules, currencies.');
  console.log('Login still works with seed users (e.g. admin@saa.com).');
  console.log('Tip: re-run `npx prisma db seed` if you want sample data again.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
