-- Re-align Counsellor permissions with product baseline (fixes misconfigured matrix rows).
UPDATE role_module_permissions rmp
SET level = data.level::"PermissionLevel"
FROM roles r
CROSS JOIN (
  VALUES
    ('DASHBOARD_REPORTS', 'read'),
    ('MASTER_SHEET', 'full'),
    ('INVOICES_RECEIVABLES', 'none'),
    ('EXPENSES_PETTY_CASH', 'none'),
    ('JOURNAL_ENTRIES', 'none'),
    ('APPROVALS', 'none'),
    ('SETTINGS', 'none'),
    ('SUB_AGENTS_PAYABLES', 'none'),
    ('BANK_CASH', 'none'),
    ('TAX_COMPLIANCE', 'none'),
    ('OPERATIONS', 'none')
) AS data(module_code, level)
JOIN modules m ON m.code = data.module_code
WHERE rmp.role_id = r.id
  AND rmp.module_id = m.id
  AND r.code = 'COUNSELLOR';
