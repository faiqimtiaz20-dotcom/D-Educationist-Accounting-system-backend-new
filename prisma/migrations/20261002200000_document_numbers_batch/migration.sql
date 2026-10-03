-- Human-readable document / master numbers (batch)

-- Universities
ALTER TABLE "universities" ADD COLUMN IF NOT EXISTS "university_no" VARCHAR(40);
WITH n AS (
  SELECT id, 'UNI-' || lpad(row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, name)::text, 3, '0') AS no
  FROM universities WHERE university_no IS NULL OR university_no = ''
)
UPDATE universities u SET university_no = n.no FROM n WHERE u.id = n.id;
ALTER TABLE "universities" ALTER COLUMN "university_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "universities_tenant_id_university_no_key" ON "universities"("tenant_id", "university_no");

-- Vendors
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "vendor_no" VARCHAR(40);
WITH n AS (
  SELECT id, 'VEN-' || lpad(row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, name)::text, 3, '0') AS no
  FROM vendors WHERE vendor_no IS NULL OR vendor_no = ''
)
UPDATE vendors v SET vendor_no = n.no FROM n WHERE v.id = n.id;
ALTER TABLE "vendors" ALTER COLUMN "vendor_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_tenant_id_vendor_no_key" ON "vendors"("tenant_id", "vendor_no");

-- Sub-agent commissions
ALTER TABLE "sub_agent_commissions" ADD COLUMN IF NOT EXISTS "commission_no" VARCHAR(40);
WITH n AS (
  SELECT c.id,
    'COM-' || COALESCE(b.code, 'GEN') || '-' || EXTRACT(YEAR FROM c.created_at)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY c.tenant_id, COALESCE(b.code, 'GEN'), EXTRACT(YEAR FROM c.created_at) ORDER BY c.created_at)::text, 3, '0') AS no
  FROM sub_agent_commissions c
  LEFT JOIN branches b ON b.id = c.branch_id
  WHERE c.commission_no IS NULL OR c.commission_no = ''
)
UPDATE sub_agent_commissions c SET commission_no = n.no FROM n WHERE c.id = n.id;
ALTER TABLE "sub_agent_commissions" ALTER COLUMN "commission_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sub_agent_commissions_tenant_id_commission_no_key" ON "sub_agent_commissions"("tenant_id", "commission_no");

-- Sub-agent payments
ALTER TABLE "sub_agent_payments" ADD COLUMN IF NOT EXISTS "payment_no" VARCHAR(40);
WITH n AS (
  SELECT id,
    'PV-' || EXTRACT(YEAR FROM created_at)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY tenant_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::text, 3, '0') AS no
  FROM sub_agent_payments WHERE payment_no IS NULL OR payment_no = ''
)
UPDATE sub_agent_payments p SET payment_no = n.no FROM n WHERE p.id = n.id;
ALTER TABLE "sub_agent_payments" ALTER COLUMN "payment_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sub_agent_payments_tenant_id_payment_no_key" ON "sub_agent_payments"("tenant_id", "payment_no");

-- Petty cash
ALTER TABLE "petty_cash_entries" ADD COLUMN IF NOT EXISTS "petty_cash_no" VARCHAR(40);
WITH n AS (
  SELECT e.id,
    'PC-' || COALESCE(b.code, 'GEN') || '-' || EXTRACT(YEAR FROM e.entry_date)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY e.tenant_id, COALESCE(b.code, 'GEN'), EXTRACT(YEAR FROM e.entry_date) ORDER BY e.entry_date, e.created_at)::text, 3, '0') AS no
  FROM petty_cash_entries e
  LEFT JOIN branches b ON b.id = e.branch_id
  WHERE e.petty_cash_no IS NULL OR e.petty_cash_no = ''
)
UPDATE petty_cash_entries e SET petty_cash_no = n.no FROM n WHERE e.id = n.id;
ALTER TABLE "petty_cash_entries" ALTER COLUMN "petty_cash_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "petty_cash_entries_tenant_id_petty_cash_no_key" ON "petty_cash_entries"("tenant_id", "petty_cash_no");

-- Contra
ALTER TABLE "contra_entries" ADD COLUMN IF NOT EXISTS "contra_no" VARCHAR(40);
WITH n AS (
  SELECT id,
    'CE-' || EXTRACT(YEAR FROM entry_date)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY tenant_id, EXTRACT(YEAR FROM entry_date) ORDER BY entry_date, created_at)::text, 3, '0') AS no
  FROM contra_entries WHERE contra_no IS NULL OR contra_no = ''
)
UPDATE contra_entries c SET contra_no = n.no FROM n WHERE c.id = n.id;
ALTER TABLE "contra_entries" ALTER COLUMN "contra_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "contra_entries_tenant_id_contra_no_key" ON "contra_entries"("tenant_id", "contra_no");

-- Employees
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "employee_no" VARCHAR(40);
WITH n AS (
  SELECT id, 'EMP-' || lpad(row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, full_name)::text, 3, '0') AS no
  FROM employees WHERE employee_no IS NULL OR employee_no = ''
)
UPDATE employees e SET employee_no = n.no FROM n WHERE e.id = n.id;
ALTER TABLE "employees" ALTER COLUMN "employee_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "employees_tenant_id_employee_no_key" ON "employees"("tenant_id", "employee_no");

-- Payroll runs
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "run_no" VARCHAR(40);
WITH n AS (
  SELECT r.id,
    'PR-' || COALESCE(b.code, 'GEN') || '-' || EXTRACT(YEAR FROM r.run_date)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY r.tenant_id, COALESCE(b.code, 'GEN'), EXTRACT(YEAR FROM r.run_date) ORDER BY r.run_date, r.created_at)::text, 3, '0') AS no
  FROM payroll_runs r
  LEFT JOIN branches b ON b.id = r.branch_id
  WHERE r.run_no IS NULL OR r.run_no = ''
)
UPDATE payroll_runs r SET run_no = n.no FROM n WHERE r.id = n.id;
ALTER TABLE "payroll_runs" ALTER COLUMN "run_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_tenant_id_run_no_key" ON "payroll_runs"("tenant_id", "run_no");

-- Reimbursements
ALTER TABLE "reimbursements" ADD COLUMN IF NOT EXISTS "reimbursement_no" VARCHAR(40);
WITH n AS (
  SELECT id,
    'REIM-' || EXTRACT(YEAR FROM reimbursement_date)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY tenant_id, EXTRACT(YEAR FROM reimbursement_date) ORDER BY reimbursement_date, created_at)::text, 3, '0') AS no
  FROM reimbursements WHERE reimbursement_no IS NULL OR reimbursement_no = ''
)
UPDATE reimbursements r SET reimbursement_no = n.no FROM n WHERE r.id = n.id;
ALTER TABLE "reimbursements" ALTER COLUMN "reimbursement_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "reimbursements_tenant_id_reimbursement_no_key" ON "reimbursements"("tenant_id", "reimbursement_no");

-- Approvals
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "approval_no" VARCHAR(40);
WITH n AS (
  SELECT id,
    'APR-' || EXTRACT(YEAR FROM created_at)::text || '-' ||
    lpad(row_number() OVER (PARTITION BY tenant_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::text, 3, '0') AS no
  FROM approvals WHERE approval_no IS NULL OR approval_no = ''
)
UPDATE approvals a SET approval_no = n.no FROM n WHERE a.id = n.id;
ALTER TABLE "approvals" ALTER COLUMN "approval_no" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "approvals_tenant_id_approval_no_key" ON "approvals"("tenant_id", "approval_no");
