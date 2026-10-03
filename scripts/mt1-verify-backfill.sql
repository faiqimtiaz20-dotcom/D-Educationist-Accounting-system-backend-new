SELECT id, code, name, status FROM tenants;
SELECT
  (SELECT COUNT(*) FROM branches WHERE tenant_id IS NULL) AS branches_null,
  (SELECT COUNT(*) FROM users WHERE tenant_id IS NULL) AS users_null,
  (SELECT COUNT(*) FROM students WHERE tenant_id IS NULL) AS students_null,
  (SELECT COUNT(*) FROM invoices WHERE tenant_id IS NULL) AS invoices_null,
  (SELECT COUNT(*) FROM gl_accounts WHERE tenant_id IS NULL) AS gl_null,
  (SELECT COUNT(*) FROM audit_logs WHERE tenant_id IS NULL) AS audit_null;
SELECT
  (SELECT COUNT(*) FROM branches WHERE tenant_id = 'a0000000-0000-4000-8000-000000000001') AS branches_ded,
  (SELECT COUNT(*) FROM users WHERE tenant_id = 'a0000000-0000-4000-8000-000000000001') AS users_ded,
  (SELECT COUNT(*) FROM students WHERE tenant_id = 'a0000000-0000-4000-8000-000000000001') AS students_ded;
