const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const p = new PrismaClient();
const tid = 'a0000000-0000-4000-8000-000000000001';

/** Tables that must have tenant_id per MT1 inventory (business). */
const REQUIRED = [
  ['branch', 'branches'],
  ['user', 'users'],
  ['fxRate', 'fx_rates'],
  ['systemSetting', 'system_settings'],
  ['expenseCategory', 'expense_categories'],
  ['pettyCashCategory', 'petty_cash_categories'],
  ['university', 'universities'],
  ['subAgent', 'sub_agents'],
  ['vendor', 'vendors'],
  ['student', 'students'],
  ['invoice', 'invoices'],
  ['otherInvoice', 'other_invoices'],
  ['bankAccount', 'bank_accounts'],
  ['receivable', 'receivables'],
  ['subAgentCommission', 'sub_agent_commissions'],
  ['subAgentPayment', 'sub_agent_payments'],
  ['pettyCashEntry', 'petty_cash_entries'],
  ['expense', 'expenses'],
  ['bankTransaction', 'bank_transactions'],
  ['cheque', 'cheques'],
  ['contraEntry', 'contra_entries'],
  ['glAccount', 'gl_accounts'],
  ['journalEntry', 'journal_entries'],
  ['partyLedgerEntry', 'party_ledger_entries'],
  ['taxRecord', 'tax_records'],
  ['employee', 'employees'],
  ['payrollRun', 'payroll_runs'],
  ['reimbursement', 'reimbursements'],
  ['document', 'documents'],
  ['approval', 'approvals'],
  ['auditLog', 'audit_logs'],
];

async function main() {
  const tenants = await p.tenant.findMany();
  const migrations = await p.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at`,
  );

  const results = [];
  for (const [delegate, table] of REQUIRED) {
    const total = await p[delegate].count();
    const onDed = await p[delegate].count({ where: { tenantId: tid } });
    // nullable only for user + auditLog
    let nullCount = 0;
    if (delegate === 'user' || delegate === 'auditLog') {
      nullCount = await p[delegate].count({ where: { tenantId: null } });
    }
    const wrong = total - onDed - nullCount;
    results.push({
      table,
      total,
      onDed,
      nullCount,
      wrong,
      ok: wrong === 0,
    });
  }

  // schema models with tenantId
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)].map(
    (m) => ({
      name: m[1],
      hasTenantId: /\ntenantId\s+/.test(m[2]),
    }),
  );

  const withTenant = models.filter((m) => m.hasTenantId).map((m) => m.name);
  const withoutTenant = models
    .filter((m) => !m.hasTenantId && m.name !== 'Tenant')
    .map((m) => m.name);

  console.log(
    JSON.stringify(
      {
        tenants,
        migrations,
        backfill: results,
        allBackfillOk: results.every((r) => r.ok),
        schemaModelsWithTenantId: withTenant.sort(),
        schemaModelsWithoutTenantId: withoutTenant.sort(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
