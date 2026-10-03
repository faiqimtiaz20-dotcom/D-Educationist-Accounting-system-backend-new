-- Accountant gap fixes: new JE source types + GL accounts
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'SubAgentCommission';
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'PayrollPayment';
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'BulkReceivable';

-- Remittance clearing (unallocated bulk receipts) + FX Loss
INSERT INTO gl_accounts (id, tenant_id, code, name, account_type, parent_id, is_postable, is_active, sort_order)
SELECT gen_random_uuid(), t.id, '1220', 'Unallocated Remittances', 'liability',
  (SELECT id FROM gl_accounts g WHERE g.tenant_id = t.id AND g.code = '2000' LIMIT 1),
  true, true, 9
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM gl_accounts g WHERE g.tenant_id = t.id AND g.code = '1220'
);

INSERT INTO gl_accounts (id, tenant_id, code, name, account_type, parent_id, is_postable, is_active, sort_order)
SELECT gen_random_uuid(), t.id, '5500', 'FX Loss', 'expense',
  (SELECT id FROM gl_accounts g WHERE g.tenant_id = t.id AND g.code = '5000' LIMIT 1),
  true, true, 45
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM gl_accounts g WHERE g.tenant_id = t.id AND g.code = '5500'
);
