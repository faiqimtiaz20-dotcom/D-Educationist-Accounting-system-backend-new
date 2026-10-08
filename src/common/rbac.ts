import { PermissionLevel } from '@prisma/client';

const RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  limited: 2,
  full: 3,
};

export function permissionAtLeast(
  actual: PermissionLevel,
  required: PermissionLevel,
): boolean {
  return RANK[actual] >= RANK[required];
}

export const MODULE_CODES = {
  DASHBOARD_REPORTS: 'DASHBOARD_REPORTS',
  MASTER_SHEET: 'MASTER_SHEET',
  INVOICES_RECEIVABLES: 'INVOICES_RECEIVABLES',
  EXPENSES_PETTY_CASH: 'EXPENSES_PETTY_CASH',
  JOURNAL_ENTRIES: 'JOURNAL_ENTRIES',
  APPROVALS: 'APPROVALS',
  SETTINGS: 'SETTINGS',
  SUB_AGENTS_PAYABLES: 'SUB_AGENTS_PAYABLES',
  BANK_CASH: 'BANK_CASH',
  TAX_COMPLIANCE: 'TAX_COMPLIANCE',
  OPERATIONS: 'OPERATIONS',
} as const;

export const ROLE_CODES = {
  CRM_ADMIN: 'CRM_ADMIN',
  TENANT_ADMIN: 'TENANT_ADMIN',
  /** @deprecated Prefer TENANT_ADMIN; still accepted as alias (MT2 map). */
  SUPER_ADMIN: 'SUPER_ADMIN',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
  CASHIER: 'CASHIER',
  COUNSELLOR: 'COUNSELLOR',
  READ_ONLY: 'READ_ONLY',
} as const;

/** Platform CRM operator — no tenant business modules. */
export function isCrmAdminRole(roleCode: string) {
  return roleCode === ROLE_CODES.CRM_ADMIN;
}

/** All-branches within one tenant (former Super Admin). */
export function isTenantAdminRole(roleCode: string) {
  return (
    roleCode === ROLE_CODES.TENANT_ADMIN ||
    roleCode === ROLE_CODES.SUPER_ADMIN
  );
}

/**
 * Head Office Branch Manager / Accountant may view & write across all
 * branches in their tenant (same data scope as Tenant Admin for branch filters).
 */
export function isHeadOfficeAllBranchesRole(roleCode: string) {
  return (
    roleCode === ROLE_CODES.BRANCH_MANAGER ||
    roleCode === ROLE_CODES.ACCOUNTANT
  );
}

/** Tenant Admin, or HO-assigned BM/Accountant. Never cross-tenant. */
export function canAccessAllTenantBranches(
  roleCode: string,
  branchIsHeadOffice?: boolean | null,
) {
  if (isTenantAdminRole(roleCode)) return true;
  return Boolean(branchIsHeadOffice) && isHeadOfficeAllBranchesRole(roleCode);
}

/** @deprecated Use isTenantAdminRole — kept for call-site compatibility. */
export function isSuperAdminRole(roleCode: string) {
  return isTenantAdminRole(roleCode);
}

export function canManageBranches(roleCode: string) {
  return isTenantAdminRole(roleCode);
}

export function canManageUsers(roleCode: string) {
  return (
    isTenantAdminRole(roleCode) || roleCode === ROLE_CODES.BRANCH_MANAGER
  );
}

export function canEditPermissionMatrix(roleCode: string) {
  return isTenantAdminRole(roleCode);
}

export function assignableRoleCodes(actorRoleCode: string): string[] {
  if (isTenantAdminRole(actorRoleCode)) {
    return [
      ROLE_CODES.BRANCH_MANAGER,
      ROLE_CODES.ACCOUNTANT,
      ROLE_CODES.CASHIER,
      ROLE_CODES.COUNSELLOR,
      ROLE_CODES.READ_ONLY,
    ];
  }
  if (actorRoleCode === ROLE_CODES.BRANCH_MANAGER) {
    return [
      ROLE_CODES.ACCOUNTANT,
      ROLE_CODES.CASHIER,
      ROLE_CODES.COUNSELLOR,
      ROLE_CODES.READ_ONLY,
    ];
  }
  return [];
}

/** Tenant staff roles (not platform CRM). */
export function isTenantStaffRole(roleCode: string) {
  return !isCrmAdminRole(roleCode);
}
