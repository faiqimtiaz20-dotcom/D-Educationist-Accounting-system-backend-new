import { PrismaClient, PermissionLevel } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

/** Must match migration backfill + backend/src/common/tenant.constants.ts */
const DEFAULT_TENANT_ID = 'a0000000-0000-4000-8000-000000000001';

/** Dev/seed password only — change after first login in real deployments. */
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe123!';

const ROLES = [
  { code: 'CRM_ADMIN', name: 'CRM Admin' },
  { code: 'TENANT_ADMIN', name: 'Tenant Admin' },
  { code: 'SUPER_ADMIN', name: 'Super Admin' }, // legacy alias; migrated users → TENANT_ADMIN
  { code: 'BRANCH_MANAGER', name: 'Branch Manager' },
  { code: 'ACCOUNTANT', name: 'Accountant' },
  { code: 'CASHIER', name: 'Cashier' },
  { code: 'COUNSELLOR', name: 'Counsellor' },
  { code: 'READ_ONLY', name: 'Read Only' },
] as const;

const MODULES = [
  { code: 'DASHBOARD_REPORTS', name: 'Dashboard & Reports' },
  { code: 'MASTER_SHEET', name: 'Master Sheet / Students' },
  { code: 'INVOICES_RECEIVABLES', name: 'Invoices & Receivables' },
  { code: 'EXPENSES_PETTY_CASH', name: 'Expenses & Petty Cash' },
  { code: 'JOURNAL_ENTRIES', name: 'Journal Entries' },
  { code: 'APPROVALS', name: 'Approvals' },
  { code: 'SETTINGS', name: 'Settings' },
  { code: 'SUB_AGENTS_PAYABLES', name: 'Sub-Agents & Payables' },
  { code: 'BANK_CASH', name: 'Bank & Cash' },
  { code: 'TAX_COMPLIANCE', name: 'Tax & Compliance' },
  { code: 'OPERATIONS', name: 'Operations' },
] as const;

/** Aligned with frontend src/lib/permissions.ts DEFAULT_PERMISSION_MATRIX */
const MATRIX: Record<string, Record<string, PermissionLevel>> = {
  DASHBOARD_REPORTS: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'read',
    CASHIER: 'read',
    COUNSELLOR: 'read',
    READ_ONLY: 'read',
  },
  MASTER_SHEET: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'read',
    CASHIER: 'none',
    COUNSELLOR: 'full',
    READ_ONLY: 'read',
  },
  INVOICES_RECEIVABLES: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'full',
    CASHIER: 'read',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
  EXPENSES_PETTY_CASH: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'full',
    CASHIER: 'full',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
  JOURNAL_ENTRIES: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'limited',
    ACCOUNTANT: 'full',
    CASHIER: 'none',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
  APPROVALS: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'limited',
    CASHIER: 'none',
    COUNSELLOR: 'none',
    READ_ONLY: 'none',
  },
  SETTINGS: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'limited',
    ACCOUNTANT: 'none',
    CASHIER: 'none',
    COUNSELLOR: 'none',
    READ_ONLY: 'none',
  },
  SUB_AGENTS_PAYABLES: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'full',
    CASHIER: 'read',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
  BANK_CASH: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'full',
    CASHIER: 'read',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
  TAX_COMPLIANCE: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'read',
    ACCOUNTANT: 'full',
    CASHIER: 'none',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
  OPERATIONS: {
    SUPER_ADMIN: 'full',
    BRANCH_MANAGER: 'full',
    ACCOUNTANT: 'read',
    CASHIER: 'none',
    COUNSELLOR: 'none',
    READ_ONLY: 'read',
  },
};

const BRANCHES = [
  { code: 'HO', name: 'Head Office', city: 'Karachi', isHeadOffice: true },
  { code: 'KHI', name: 'Karachi Branch', city: 'Karachi', isHeadOffice: false },
  { code: 'LHR', name: 'Lahore Branch', city: 'Lahore', isHeadOffice: false },
  { code: 'ISB', name: 'Islamabad Branch', city: 'Islamabad', isHeadOffice: false },
  { code: 'MUL', name: 'Multan Branch', city: 'Multan', isHeadOffice: false },
  { code: 'FSD', name: 'Faisalabad Branch', city: 'Faisalabad', isHeadOffice: false },
];

const CURRENCIES = [
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'PKR ', sortOrder: 1 },
  { code: 'GBP', name: 'British Pound', symbol: '£', sortOrder: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', sortOrder: 3 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', sortOrder: 4 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', sortOrder: 5 },
  { code: 'EUR', name: 'Euro', symbol: '€', sortOrder: 6 },
];

const FX = [
  { code: 'PKR', rate: 1 },
  { code: 'GBP', rate: 355 },
  { code: 'USD', rate: 278 },
  { code: 'CAD', rate: 205 },
  { code: 'AUD', rate: 185 },
  { code: 'EUR', rate: 300 },
];

const PAYMENT_MODES = ['Cash', 'Bank', 'Cheque', 'Online'];

async function main() {
  console.log('Seeding M2 auth/org data...');
  console.log(`Seed password for demo users: ${SEED_PASSWORD}`);

  await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    create: {
      id: DEFAULT_TENANT_ID,
      code: 'DED',
      name: "D' Educationist",
      status: 'Active',
    },
    update: {
      code: 'DED',
      name: "D' Educationist",
      status: 'Active',
      deletedAt: null,
    },
  });

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: role,
      update: { name: role.name },
    });
  }

  for (const mod of MODULES) {
    await prisma.appModule.upsert({
      where: { code: mod.code },
      create: mod,
      update: { name: mod.name },
    });
  }

  const roles = await prisma.role.findMany();
  const modules = await prisma.appModule.findMany();
  const roleByCode = Object.fromEntries(roles.map((r) => [r.code, r]));
  const moduleByCode = Object.fromEntries(modules.map((m) => [m.code, m]));

  for (const [moduleCode, byRole] of Object.entries(MATRIX)) {
    for (const [roleCode, level] of Object.entries(byRole)) {
      const role = roleByCode[roleCode];
      const module = moduleByCode[moduleCode];
      if (!role || !module) continue;
      await prisma.roleModulePermission.upsert({
        where: {
          roleId_moduleId: { roleId: role.id, moduleId: module.id },
        },
        create: { roleId: role.id, moduleId: module.id, level },
        update: { level },
      });
    }
  }

  // MT2: TENANT_ADMIN mirrors SUPER_ADMIN matrix; CRM_ADMIN is none on all modules
  for (const mod of modules) {
    const saLevel =
      (MATRIX as Record<string, Record<string, PermissionLevel>>)[mod.code]
        ?.SUPER_ADMIN ?? 'full';
    if (roleByCode.TENANT_ADMIN) {
      await prisma.roleModulePermission.upsert({
        where: {
          roleId_moduleId: {
            roleId: roleByCode.TENANT_ADMIN.id,
            moduleId: mod.id,
          },
        },
        create: {
          roleId: roleByCode.TENANT_ADMIN.id,
          moduleId: mod.id,
          level: saLevel,
        },
        update: { level: saLevel },
      });
    }
    if (roleByCode.CRM_ADMIN) {
      await prisma.roleModulePermission.upsert({
        where: {
          roleId_moduleId: {
            roleId: roleByCode.CRM_ADMIN.id,
            moduleId: mod.id,
          },
        },
        create: {
          roleId: roleByCode.CRM_ADMIN.id,
          moduleId: mod.id,
          level: 'none',
        },
        update: { level: 'none' },
      });
    }
  }

  for (const b of BRANCHES) {
    await prisma.branch.upsert({
      where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: b.code } },
      create: { ...b, tenantId: DEFAULT_TENANT_ID },
      update: {
        name: b.name,
        city: b.city,
        isHeadOffice: b.isHeadOffice,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      create: { ...c, isEnabled: true },
      update: { name: c.name, symbol: c.symbol, sortOrder: c.sortOrder, isEnabled: true },
    });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const fx of FX) {
    await prisma.fxRate.upsert({
      where: {
        tenantId_currencyCode_effectiveDate: {
          tenantId: DEFAULT_TENANT_ID,
          currencyCode: fx.code,
          effectiveDate: today,
        },
      },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        currencyCode: fx.code,
        rateToPkr: fx.rate,
        effectiveDate: today,
      },
      update: { rateToPkr: fx.rate },
    });
  }

  for (const code of PAYMENT_MODES) {
    await prisma.paymentMode.upsert({
      where: { code },
      create: { code },
      update: {},
    });
  }

  const settings: Array<{ key: string; value: unknown }> = [
    { key: 'wht_rate_percent', value: 1 },
    {
      key: 'enabled_currencies',
      value: ['PKR', 'GBP', 'USD', 'CAD', 'AUD', 'EUR'],
    },
    { key: 'fiscal_period_locked_until', value: '2026-06-30' },
    { key: 'org_name', value: "D' Educationist" },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId: DEFAULT_TENANT_ID, key: s.key } },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        key: s.key,
        value: s.value as object,
      },
      update: { value: s.value as object },
    });
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const branches = await prisma.branch.findMany();
  const branchByCode = Object.fromEntries(branches.map((b) => [b.code, b]));

  const users = [
    {
      email: 'admin@saa.com',
      fullName: 'Admin User',
      roleCode: 'TENANT_ADMIN',
      branchCode: 'HO',
    },
    {
      email: 'ahmed@saa.com',
      fullName: 'Ahmed Khan',
      roleCode: 'BRANCH_MANAGER',
      branchCode: 'KHI',
    },
    {
      email: 'sara@saa.com',
      fullName: 'Sara Malik',
      roleCode: 'ACCOUNTANT',
      branchCode: 'LHR',
    },
    {
      email: 'bilal@saa.com',
      fullName: 'Bilal Hassan',
      roleCode: 'CASHIER',
      branchCode: 'ISB',
    },
    {
      email: 'fatima@saa.com',
      fullName: 'Fatima Noor',
      roleCode: 'COUNSELLOR',
      branchCode: 'KHI',
    },
    {
      email: 'usman@saa.com',
      fullName: 'Usman Ali',
      roleCode: 'ACCOUNTANT',
      branchCode: 'MUL',
    },
    {
      email: 'hina@saa.com',
      fullName: 'Hina Shah',
      roleCode: 'READ_ONLY',
      branchCode: 'FSD',
    },
    {
      email: 'zain@saa.com',
      fullName: 'Zain Tariq',
      roleCode: 'BRANCH_MANAGER',
      branchCode: 'LHR',
    },
  ];

  for (const u of users) {
    const role = roleByCode[u.roleCode];
    const branch = branchByCode[u.branchCode];
    if (!role || !branch) continue;

    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        fullName: u.fullName,
        passwordHash,
        roleId: role.id,
        tenantId: DEFAULT_TENANT_ID,
        branchId: branch.id,
        isActive: true,
      },
      update: {
        fullName: u.fullName,
        passwordHash,
        roleId: role.id,
        tenantId: DEFAULT_TENANT_ID,
        branchId: branch.id,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  // ── MT2: migrate legacy SUPER_ADMIN → TENANT_ADMIN; seed CRM + demo tenant ─
  if (roleByCode.SUPER_ADMIN && roleByCode.TENANT_ADMIN) {
    await prisma.user.updateMany({
      where: { roleId: roleByCode.SUPER_ADMIN.id, deletedAt: null },
      data: { roleId: roleByCode.TENANT_ADMIN.id },
    });
  }

  if (roleByCode.CRM_ADMIN) {
    await prisma.user.upsert({
      where: { email: 'crm@platform.local' },
      create: {
        email: 'crm@platform.local',
        fullName: 'CRM Platform Admin',
        passwordHash,
        roleId: roleByCode.CRM_ADMIN.id,
        tenantId: null,
        branchId: null,
        isActive: true,
      },
      update: {
        fullName: 'CRM Platform Admin',
        passwordHash,
        roleId: roleByCode.CRM_ADMIN.id,
        tenantId: null,
        branchId: null,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  const DEMO_TENANT_ID = 'b0000000-0000-4000-8000-000000000002';
  await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    create: {
      id: DEMO_TENANT_ID,
      code: 'DEMO',
      name: 'Demo Agency (MT2)',
      status: 'Active',
    },
    update: {
      code: 'DEMO',
      name: 'Demo Agency (MT2)',
      status: 'Active',
      deletedAt: null,
    },
  });
  const demoBranch = await prisma.branch.upsert({
    where: {
      tenantId_code: { tenantId: DEMO_TENANT_ID, code: 'HO' },
    },
    create: {
      tenantId: DEMO_TENANT_ID,
      code: 'HO',
      name: 'Demo Head Office',
      city: 'Karachi',
      isHeadOffice: true,
      isActive: true,
    },
    update: {
      name: 'Demo Head Office',
      city: 'Karachi',
      isHeadOffice: true,
      isActive: true,
      deletedAt: null,
    },
  });
  if (roleByCode.TENANT_ADMIN) {
    await prisma.user.upsert({
      where: { email: 'admin@demo.local' },
      create: {
        email: 'admin@demo.local',
        fullName: 'Demo Tenant Admin',
        passwordHash,
        roleId: roleByCode.TENANT_ADMIN.id,
        tenantId: DEMO_TENANT_ID,
        branchId: demoBranch.id,
        isActive: true,
      },
      update: {
        fullName: 'Demo Tenant Admin',
        passwordHash,
        roleId: roleByCode.TENANT_ADMIN.id,
        tenantId: DEMO_TENANT_ID,
        branchId: demoBranch.id,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  // ── M3 masters seed ───────────────────────────────────────────────────────
  const countries = [
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'DE', name: 'Germany' },
    { code: 'IE', name: 'Ireland' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'PK', name: 'Pakistan' },
  ];
  for (const c of countries) {
    await prisma.country.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name },
    });
  }

  const { COA_SEED } = await import('../src/masters/masters.service');
  const coaByCode = new Map<string, string>();
  for (const item of COA_SEED) {
    const parentId = item.parentCode ? coaByCode.get(item.parentCode) ?? null : null;
    const row = await prisma.glAccount.upsert({
      where: {
        tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: item.code },
      },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        code: item.code,
        name: item.name,
        accountType: item.accountType,
        parentId,
        isPostable: item.isPostable,
        isActive: true,
        sortOrder: item.sortOrder,
      },
      update: {
        name: item.name,
        accountType: item.accountType,
        parentId,
        isPostable: item.isPostable,
        isActive: true,
        sortOrder: item.sortOrder,
      },
    });
    coaByCode.set(item.code, row.id);
  }

  const universities = [
    { universityNo: 'UNI-001', name: 'University of Manchester', countryName: 'UK', countryCode: 'GB', defaultCommissionRate: 15, currencyCode: 'GBP' },
    { universityNo: 'UNI-002', name: 'Arizona State University', countryName: 'USA', countryCode: 'US', defaultCommissionRate: 12.5, currencyCode: 'USD' },
    { universityNo: 'UNI-003', name: 'University of Toronto', countryName: 'Canada', countryCode: 'CA', defaultCommissionRate: 17.5, currencyCode: 'CAD' },
    { universityNo: 'UNI-004', name: 'Monash University', countryName: 'Australia', countryCode: 'AU', defaultCommissionRate: 17.5, currencyCode: 'AUD' },
    { universityNo: 'UNI-005', name: 'Coventry University', countryName: 'UK', countryCode: 'GB', defaultCommissionRate: 15, currencyCode: 'GBP' },
    { universityNo: 'UNI-006', name: 'Northeastern University', countryName: 'USA', countryCode: 'US', defaultCommissionRate: 10, currencyCode: 'USD' },
    { universityNo: 'UNI-007', name: 'University of Birmingham', countryName: 'UK', countryCode: 'GB', defaultCommissionRate: 15, currencyCode: 'GBP' },
    { universityNo: 'UNI-008', name: 'McGill University', countryName: 'Canada', countryCode: 'CA', defaultCommissionRate: 12.5, currencyCode: 'CAD' },
    { universityNo: 'UNI-009', name: 'University of Melbourne', countryName: 'Australia', countryCode: 'AU', defaultCommissionRate: 17.5, currencyCode: 'AUD' },
    { universityNo: 'UNI-010', name: 'University of Leeds', countryName: 'UK', countryCode: 'GB', defaultCommissionRate: 15, currencyCode: 'GBP' },
  ];
  for (const u of universities) {
    const existing = await prisma.university.findFirst({
      where: { name: u.name, deletedAt: null },
    });
    if (existing) {
      await prisma.university.update({
        where: { id: existing.id },
        data: { ...u, isActive: true },
      });
    } else {
      await prisma.university.create({ data: { ...u, isActive: true } });
    }
  }

  const subAgents = [
    { subAgentNo: 'SA-001', name: 'Global Edu Partners', ntn: '1234567-8', email: 'contact@globaledu.pk', contact: '+92 300 1112233', accountTitle: 'Global Edu Partners', iban: 'PK36SCBL0000001123456702', accountNo: '0123456702' },
    { subAgentNo: 'SA-002', name: 'Study Link Associates', ntn: '2345678-9', email: 'info@studylink.pk', contact: '+92 321 2223344', accountTitle: 'Study Link Associates', iban: 'PK36HABB0000002234567803', accountNo: '0234567803' },
    { subAgentNo: 'SA-003', name: 'Overseas Connect', ntn: '3456789-0', email: 'hello@overseasconnect.pk', contact: '+92 333 3334455', accountTitle: 'Overseas Connect Pvt Ltd', iban: 'PK36MEZN0000003345678904', accountNo: '0345678904' },
    { subAgentNo: 'SA-004', name: 'Future Path Consultants', ntn: '4567890-1', email: 'admin@futurepath.pk', contact: '+92 345 4445566', accountTitle: 'Future Path Consultants', iban: 'PK36UNIL0000004456789015', accountNo: '0456789015' },
    { subAgentNo: 'SA-005', name: 'EduBridge Pakistan', ntn: '5678901-2', email: 'support@edubridge.pk', contact: '+92 300 5556677', accountTitle: 'EduBridge Pakistan', iban: 'PK36SCBL0000005567890126', accountNo: '0567890126' },
    { subAgentNo: 'SA-006', name: 'Horizon Study Abroad', ntn: '6789012-3', email: 'team@horizonstudy.pk', contact: '+92 321 6667788', accountTitle: 'Horizon Study Abroad', iban: 'PK36HABB0000006678901237', accountNo: '0678901237' },
  ];
  for (const s of subAgents) {
    const existing = await prisma.subAgent.findFirst({
      where: { name: s.name, deletedAt: null },
    });
    if (existing) {
      await prisma.subAgent.update({ where: { id: existing.id }, data: { ...s, isActive: true } });
    } else {
      await prisma.subAgent.create({ data: { ...s, isActive: true } });
    }
  }

  const vendors = [
    { vendorNo: 'VEN-001', name: 'Office Mart', ntn: '1122334-5' },
    { vendorNo: 'VEN-002', name: 'Rent Properties', ntn: '2233445-6' },
    { vendorNo: 'VEN-003', name: 'City Utilities', ntn: '3344556-7' },
  ];
  for (const v of vendors) {
    const existing = await prisma.vendor.findFirst({
      where: { name: v.name, deletedAt: null },
    });
    if (existing) {
      await prisma.vendor.update({ where: { id: existing.id }, data: { ...v, isActive: true } });
    } else {
      await prisma.vendor.create({ data: { ...v, isActive: true } });
    }
  }

  const pettyCats = [
    'Stationery',
    'Refreshments',
    'Courier',
    'Printing',
    'Transport',
    'Utilities',
    'Maintenance',
    'Imprest',
  ];
  for (const name of pettyCats) {
    await prisma.pettyCashCategory.upsert({
      where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name } },
      create: { tenantId: DEFAULT_TENANT_ID, name, isActive: true },
      update: { isActive: true },
    });
  }

  const expenseCats = [
    'Office Rent',
    'Utilities',
    'Marketing',
    'Travel',
    'Salaries Related',
    'Professional Fees',
    'IT & Software',
    'Miscellaneous',
  ];
  for (const name of expenseCats) {
    await prisma.expenseCategory.upsert({
      where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name } },
      create: { tenantId: DEFAULT_TENANT_ID, name, isActive: true },
      update: { isActive: true },
    });
  }

  const bankDefs = [
    { name: 'GBP Collection Account', bankName: 'Standard Chartered', accountNo: '0123456789', branchCode: 'HO', currencyCode: 'GBP', openingBalance: 45200 },
    { name: 'CAD Collection Account', bankName: 'HBL', accountNo: '0234567890', branchCode: 'HO', currencyCode: 'CAD', openingBalance: 28500 },
    { name: 'USD Collection Account', bankName: 'MCB', accountNo: '0345678901', branchCode: 'HO', currencyCode: 'USD', openingBalance: 67800 },
    { name: 'AUD Collection Account', bankName: 'UBL', accountNo: '0456789012', branchCode: 'HO', currencyCode: 'AUD', openingBalance: 19200 },
    { name: 'PKR Operating Account', bankName: 'Meezan Bank', accountNo: '0567890123', branchCode: 'HO', currencyCode: 'PKR', openingBalance: 12500000 },
    { name: 'Karachi Branch Account', bankName: 'HBL', accountNo: '0678901234', branchCode: 'KHI', currencyCode: 'PKR', openingBalance: 3200000 },
    { name: 'Lahore Branch Account', bankName: 'UBL', accountNo: '0789012345', branchCode: 'LHR', currencyCode: 'PKR', openingBalance: 2100000 },
    { name: 'Petty Cash Bank', bankName: 'MCB', accountNo: '0890123456', branchCode: 'HO', currencyCode: 'PKR', openingBalance: 850000 },
  ];
  for (const b of bankDefs) {
    const branch = branchByCode[b.branchCode];
    if (!branch) continue;
    const existing = await prisma.bankAccount.findFirst({
      where: { accountNo: b.accountNo, deletedAt: null },
    });
    if (existing) {
      await prisma.bankAccount.update({
        where: { id: existing.id },
        data: {
          name: b.name,
          bankName: b.bankName,
          branchId: branch.id,
          currencyCode: b.currencyCode,
          openingBalance: b.openingBalance,
          isActive: true,
        },
      });
    } else {
      await prisma.bankAccount.create({
        data: {
          name: b.name,
          bankName: b.bankName,
          accountNo: b.accountNo,
          branchId: branch.id,
          currencyCode: b.currencyCode,
          openingBalance: b.openingBalance,
          isActive: true,
        },
      });
    }
  }

  // ── M4 courses master + sample students ───────────────────────────────────
  const courseNames = [
    'MSc Data Science',
    'BSc Computer Science',
    'MBA',
    'MEng Civil',
    'BA Business',
    'MSc Demo',
    'Unspecified',
  ];
  const courseByName: Record<string, { id: string; name: string }> = {};
  for (const name of courseNames) {
    const row = await prisma.course.upsert({
      where: {
        tenantId_name: { tenantId: DEFAULT_TENANT_ID, name },
      },
      create: { tenantId: DEFAULT_TENANT_ID, name, isActive: true },
      update: { isActive: true, deletedAt: null },
    });
    courseByName[name] = row;
  }

  const counsellorFatima = await prisma.user.findUnique({
    where: { email: 'fatima@saa.com' },
  });
  const unis = await prisma.university.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });
  const uniByName = Object.fromEntries(unis.map((u) => [u.name, u]));

  // Sample uni × course commission rates (others fall back to university default)
  const courseRateSeed: Array<{
    universityName: string;
    courseName: string;
    commissionRate: number;
  }> = [
    { universityName: 'University of Manchester', courseName: 'MSc Data Science', commissionRate: 15 },
    { universityName: 'University of Manchester', courseName: 'MBA', commissionRate: 12 },
    { universityName: 'Arizona State University', courseName: 'BSc Computer Science', commissionRate: 12.5 },
    { universityName: 'Arizona State University', courseName: 'MBA', commissionRate: 10 },
    { universityName: 'University of Toronto', courseName: 'MBA', commissionRate: 17.5 },
    { universityName: 'Coventry University', courseName: 'BA Business', commissionRate: 18 },
    { universityName: 'Monash University', courseName: 'MEng Civil', commissionRate: 17.5 },
  ];
  for (const r of courseRateSeed) {
    const uni = uniByName[r.universityName];
    const course = courseByName[r.courseName];
    if (!uni || !course) continue;
    await prisma.universityCourseRate.upsert({
      where: {
        tenantId_universityId_courseId: {
          tenantId: DEFAULT_TENANT_ID,
          universityId: uni.id,
          courseId: course.id,
        },
      },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        universityId: uni.id,
        courseId: course.id,
        commissionRate: r.commissionRate,
      },
      update: { commissionRate: r.commissionRate },
    });
  }

  const subAgentsDb = await prisma.subAgent.findMany({
    where: { deletedAt: null },
  });
  const khi = branchByCode.KHI;
  const lhr = branchByCode.LHR;

  if (counsellorFatima && khi) {
    const sampleStudents = [
      {
        studentCode: 'STU-2026-001',
        fullName: 'Ayesha Rahman',
        cnicPassport: '42101-1111111-1',
        contact: '+92 300 1110001',
        email: 'ayesha.rahman@email.com',
        branchId: khi.id,
        counsellorId: counsellorFatima.id,
        country: 'UK',
        universityName: 'University of Manchester',
        course: 'MSc Data Science',
        intake: 'Sep-2026',
        studentGroup: 'G1',
        applicationStatus: 'Offer' as const,
        tuitionFee: 22000,
        scholarship: 2000,
        expectedCommissionRate: 15,
        currencyCode: 'GBP',
        subAgentIndex: 0,
      },
      {
        studentCode: 'STU-2026-002',
        fullName: 'Hassan Ali',
        cnicPassport: '42101-2222222-2',
        contact: '+92 300 1110002',
        email: 'hassan.ali@email.com',
        branchId: khi.id,
        counsellorId: counsellorFatima.id,
        country: 'USA',
        universityName: 'Arizona State University',
        course: 'BSc Computer Science',
        intake: 'Jan-2027',
        studentGroup: 'G1',
        applicationStatus: 'Applied' as const,
        tuitionFee: 32000,
        scholarship: 0,
        expectedCommissionRate: 12.5,
        currencyCode: 'USD',
        subAgentIndex: null,
      },
      {
        studentCode: 'STU-2026-003',
        fullName: 'Sana Iqbal',
        cnicPassport: '42101-3333333-3',
        contact: '+92 300 1110003',
        email: 'sana.iqbal@email.com',
        branchId: lhr?.id ?? khi.id,
        counsellorId: counsellorFatima.id,
        country: 'Canada',
        universityName: 'University of Toronto',
        course: 'MBA',
        intake: 'Sep-2026',
        studentGroup: 'G2',
        applicationStatus: 'Visa' as const,
        tuitionFee: 45000,
        scholarship: 5000,
        expectedCommissionRate: 17.5,
        currencyCode: 'CAD',
        subAgentIndex: 1,
      },
      {
        studentCode: 'STU-2026-004',
        fullName: 'Omar Farooq',
        cnicPassport: '42101-4444444-4',
        contact: '+92 300 1110004',
        email: 'omar.farooq@email.com',
        branchId: khi.id,
        counsellorId: counsellorFatima.id,
        country: 'Australia',
        universityName: 'Monash University',
        course: 'MEng Civil',
        intake: 'Feb-2027',
        studentGroup: 'G2',
        applicationStatus: 'Enrolled' as const,
        tuitionFee: 38000,
        scholarship: 3000,
        expectedCommissionRate: 17.5,
        currencyCode: 'AUD',
        subAgentIndex: null,
      },
      {
        studentCode: 'STU-2026-005',
        fullName: 'Zara Ahmed',
        cnicPassport: '42101-5555555-5',
        contact: '+92 300 1110005',
        email: 'zara.ahmed@email.com',
        branchId: khi.id,
        counsellorId: counsellorFatima.id,
        country: 'UK',
        universityName: 'Coventry University',
        course: 'BA Business',
        intake: 'Sep-2026',
        studentGroup: 'G1',
        applicationStatus: 'Applied' as const,
        tuitionFee: 16500,
        scholarship: 0,
        expectedCommissionRate: 15,
        currencyCode: 'GBP',
        subAgentIndex: 2,
      },
    ];

    for (const s of sampleStudents) {
      const uni = uniByName[s.universityName];
      if (!uni) continue;
      const course = courseByName[s.course];
      if (!course) continue;
      const subAgentId =
        s.subAgentIndex !== null && subAgentsDb[s.subAgentIndex]
          ? subAgentsDb[s.subAgentIndex].id
          : null;

      const existing = await prisma.student.findUnique({
        where: {
          tenantId_studentCode: {
            tenantId: DEFAULT_TENANT_ID,
            studentCode: s.studentCode,
          },
        },
      });

      if (existing && !existing.deletedAt) {
        await prisma.student.update({
          where: { id: existing.id },
          data: {
            fullName: s.fullName,
            cnicPassport: s.cnicPassport,
            contact: s.contact,
            email: s.email,
            branchId: s.branchId,
            counsellorId: s.counsellorId,
            country: s.country,
            universityId: uni.id,
            courseId: course.id,
            intake: s.intake,
            studentGroup: s.studentGroup,
            applicationStatus: s.applicationStatus,
            subAgentId,
            tuitionFee: s.tuitionFee,
            scholarship: s.scholarship,
            expectedCommissionRate: s.expectedCommissionRate,
            currencyCode: s.currencyCode,
            deletedAt: null,
          },
        });
      } else if (!existing) {
        const created = await prisma.student.create({
          data: {
            studentCode: s.studentCode,
            fullName: s.fullName,
            cnicPassport: s.cnicPassport,
            contact: s.contact,
            email: s.email,
            branchId: s.branchId,
            counsellorId: s.counsellorId,
            country: s.country,
            universityId: uni.id,
            courseId: course.id,
            intake: s.intake,
            studentGroup: s.studentGroup,
            applicationStatus: s.applicationStatus,
            subAgentId,
            tuitionFee: s.tuitionFee,
            scholarship: s.scholarship,
            expectedCommissionRate: s.expectedCommissionRate,
            currencyCode: s.currencyCode,
          },
        });
        await prisma.studentStatusHistory.create({
          data: {
            studentId: created.id,
            fromStatus: null,
            toStatus: s.applicationStatus,
            note: 'Seed',
          },
        });
      }
    }
  }

  // ── M5 sample invoice + remittance ────────────────────────────────────────
  const admin = await prisma.user.findUnique({ where: { email: 'admin@saa.com' } });
  const stu1 = await prisma.student.findUnique({ where: { tenantId_studentCode: { tenantId: DEFAULT_TENANT_ID, studentCode: 'STU-2026-001' } } });
  const gbpBank = await prisma.bankAccount.findFirst({
    where: { currencyCode: 'GBP', deletedAt: null },
  });
  const manUni = uniByName['University of Manchester'];

  if (stu1 && khi && manUni && admin) {
    const invNo = 'INV-KHI-2026-001';
    let invoice = await prisma.invoice.findUnique({
      where: {
        tenantId_invoiceNo: { tenantId: DEFAULT_TENANT_ID, invoiceNo: invNo },
      },
    });
    if (!invoice) {
      const commissionAmount =
        (Number(stu1.tuitionFee) - Number(stu1.scholarship)) *
        (Number(stu1.expectedCommissionRate) / 100);
      invoice = await prisma.invoice.create({
        data: {
          invoiceNo: invNo,
          branchId: khi.id,
          universityId: manUni.id,
          invoiceDate: new Date('2026-09-01'),
          currencyCode: 'GBP',
          status: 'Sent',
          exchangeRate: 355,
          sentAt: new Date(),
          createdById: admin.id,
          lines: {
            create: [
              {
                lineNo: 1,
                studentId: stu1.id,
                tuitionFee: stu1.tuitionFee,
                scholarship: stu1.scholarship,
                commissionRate: stu1.expectedCommissionRate,
                bonus: 0,
                commissionAmount,
              },
            ],
          },
        },
      });
      // Accrual JE if COA exists
      const ar = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1200' } } });
      const income = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '4100' } } });
      if (ar && income) {
        const lines = await prisma.invoiceLine.findMany({ where: { invoiceId: invoice.id } });
        const total = lines.reduce((s, l) => s + Number(l.commissionAmount), 0);
        const pkr = Math.round(total * 355 * 100) / 100;
        const existingJe = await prisma.journalEntry.findUnique({
          where: {
            sourceType_sourceId: { sourceType: 'Invoice', sourceId: invoice.id },
          },
        });
        if (!existingJe) {
          await prisma.journalEntry.create({
            data: {
              entryNo: 'JE-2026-0001',
              entryDate: new Date('2026-09-01'),
              branchId: khi.id,
              description: `Commission accrual — ${invNo}`,
              approvalStatus: 'Approved',
              sourceType: 'Invoice',
              sourceId: invoice.id,
              isAutoPosted: true,
              postedAt: new Date(),
              createdById: admin.id,
              lines: {
                create: [
                  { lineNo: 1, glAccountId: ar.id, debit: pkr, credit: 0 },
                  { lineNo: 2, glAccountId: income.id, debit: 0, credit: pkr },
                ],
              },
            },
          });
        }
      }
    }

    if (gbpBank && invoice) {
      const receiptNo = 'REC-2026-0001';
      const existingRec = await prisma.receivable.findUnique({
        where: {
          tenantId_receiptNo: { tenantId: DEFAULT_TENANT_ID, receiptNo },
        },
      });
      if (!existingRec) {
        const lineSum = await prisma.invoiceLine.aggregate({
          where: { invoiceId: invoice.id },
          _sum: { commissionAmount: true },
        });
        const amount = Number(lineSum._sum.commissionAmount ?? 0) * 0.5;
        const gross = Math.round(amount * 355 * 100) / 100;
        const wht = Math.round(gross * 0.01 * 100) / 100;
        const net = Math.round((gross - wht) * 100) / 100;
        const rec = await prisma.receivable.create({
          data: {
            receiptNo,
            branchId: khi.id,
            invoiceId: invoice.id,
            bankAccountId: gbpBank.id,
            currencyCode: 'GBP',
            amountReceived: amount,
            exchangeRate: 355,
            amountPkrGross: gross,
            whtAmountPkr: wht,
            amountPkrNet: net,
            receiptDate: new Date('2026-09-15'),
            isPartial: true,
            createdById: admin.id,
          },
        });
        const bankGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1120' } } });
        const whtGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1210' } } });
        const arGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1200' } } });
        if (bankGl && whtGl && arGl) {
          await prisma.journalEntry.create({
            data: {
              entryNo: 'JE-2026-0002',
              entryDate: new Date('2026-09-15'),
              branchId: khi.id,
              description: `University receipt ${receiptNo} — ${invNo}`,
              approvalStatus: 'Approved',
              sourceType: 'Receivable',
              sourceId: rec.id,
              isAutoPosted: true,
              postedAt: new Date(),
              createdById: admin.id,
              lines: {
                create: [
                  { lineNo: 1, glAccountId: bankGl.id, debit: net, credit: 0 },
                  { lineNo: 2, glAccountId: whtGl.id, debit: wht, credit: 0 },
                  { lineNo: 3, glAccountId: arGl.id, debit: 0, credit: gross },
                ],
              },
            },
          });
        }
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'PartiallyReceived' },
        });
      }
    }
  }

  // ── M6 sample commission + partial payment ────────────────────────────────
  const pkrBank = await prisma.bankAccount.findFirst({
    where: { currencyCode: 'PKR', deletedAt: null, name: 'Karachi Branch Account' },
  });
  const globalEdu = await prisma.subAgent.findFirst({
    where: { name: 'Global Edu Partners', deletedAt: null },
  });
  const seedInvoice = await prisma.invoice.findUnique({
    where: {
      tenantId_invoiceNo: {
        tenantId: DEFAULT_TENANT_ID,
        invoiceNo: 'INV-KHI-2026-001',
      },
    },
    include: { lines: true },
  });

  if (stu1 && khi && admin && globalEdu && seedInvoice && pkrBank) {
    const line = seedInvoice.lines[0];
    const grossFee = line ? Number(line.tuitionFee) : Number(stu1.tuitionFee);
    const rateGiven = 40;
    const exchangeRate = 355;
    const followOnBonus = 0;
    const payablePkrGross =
      Math.round((grossFee * (rateGiven / 100) * exchangeRate + followOnBonus) * 100) / 100;
    const whtPkr = Math.round(payablePkrGross * 0.01 * 100) / 100;
    const payablePkrNet = Math.round((payablePkrGross - whtPkr) * 100) / 100;

    let commission = await prisma.subAgentCommission.findUnique({
      where: {
        studentId_invoiceId_subAgentId: {
          studentId: stu1.id,
          invoiceId: seedInvoice.id,
          subAgentId: globalEdu.id,
        },
      },
    });

    if (!commission) {
      commission = await prisma.subAgentCommission.create({
        data: {
          commissionNo: 'COM-KHI-2026-001',
          subAgentId: globalEdu.id,
          studentId: stu1.id,
          invoiceId: seedInvoice.id,
          branchId: khi.id,
          grossFee,
          rateGiven,
          exchangeRate,
          followOnBonus,
          currencyCode: 'GBP',
          payablePkrGross,
          whtPkr,
          payablePkrNet,
          status: 'Partial',
        },
      });
    } else if (!commission.commissionNo) {
      await prisma.subAgentCommission.update({
        where: { id: commission.id },
        data: { commissionNo: 'COM-KHI-2026-001' },
      });
    }

    const existingPay = await prisma.subAgentPayment.findFirst({
      where: { commissionId: commission.id, chequeNo: 'CHQ-M6-0001' },
    });
    if (!existingPay) {
      const payAmount = Math.round(payablePkrNet * 0.5 * 100) / 100;
      const whtShare = Math.round((payAmount / payablePkrNet) * whtPkr * 100) / 100;
      const grossExp = Math.round((payAmount + whtShare) * 100) / 100;
      const payment = await prisma.subAgentPayment.create({
        data: {
          paymentNo: 'PV-2026-001',
          commissionId: commission.id,
          subAgentId: globalEdu.id,
          bankAccountId: pkrBank.id,
          chequeNo: 'CHQ-M6-0001',
          amountPkr: payAmount,
          paymentDate: new Date('2026-09-22'),
          currencyCode: 'PKR',
          createdById: admin.id,
        },
      });

      const expGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '5100' } } });
      const taxGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '2200' } } });
      const bankGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1120' } } });
      const existingJe = await prisma.journalEntry.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'SubAgentPayment',
            sourceId: payment.id,
          },
        },
      });
      if (!existingJe && expGl && taxGl && bankGl) {
        const entryNo = 'JE-2026-M6-0001';
        const clash = await prisma.journalEntry.findUnique({
          where: {
            tenantId_entryNo: { tenantId: DEFAULT_TENANT_ID, entryNo },
          },
        });
        if (!clash) {
          await prisma.journalEntry.create({
            data: {
              entryNo,
              entryDate: new Date('2026-09-22'),
              branchId: khi.id,
              description: `Sub-agent payment — ${globalEdu.name} chq CHQ-M6-0001`,
              approvalStatus: 'Approved',
              sourceType: 'SubAgentPayment',
              sourceId: payment.id,
              isAutoPosted: true,
              postedAt: new Date(),
              createdById: admin.id,
              lines: {
                create: [
                  { lineNo: 1, glAccountId: expGl.id, debit: grossExp, credit: 0 },
                  { lineNo: 2, glAccountId: taxGl.id, debit: 0, credit: whtShare },
                  { lineNo: 3, glAccountId: bankGl.id, debit: 0, credit: payAmount },
                ],
              },
            },
          });
        }
      }

      await prisma.subAgentCommission.update({
        where: { id: commission.id },
        data: { status: 'Partial' },
      });
    }
  }

  // ── M7 sample petty cash, expense, bank txn, cheque, contra ───────────────
  const stationery = await prisma.pettyCashCategory.findUnique({
    where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name: 'Stationery' } },
  });
  const officeRent = await prisma.expenseCategory.findUnique({
    where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name: 'Office Rent' } },
  });
  const rentVendor = await prisma.vendor.findFirst({
    where: { name: 'Rent Properties', deletedAt: null },
  });
  const khiBank = await prisma.bankAccount.findFirst({
    where: { name: 'Karachi Branch Account', deletedAt: null },
  });
  const pkrOp = await prisma.bankAccount.findFirst({
    where: { name: 'PKR Operating Account', deletedAt: null },
  });
  const cashGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1110' } } });
  const bankGlM7 = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1120' } } });
  const opexGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '5200' } } });
  const inputTaxGl = await prisma.glAccount.findUnique({ where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '1310' } } });

  if (admin && khi && stationery) {
    const existingPc = await prisma.pettyCashEntry.findFirst({
      where: { description: 'Seed stationery purchase' },
    });
    if (!existingPc) {
      const pc = await prisma.pettyCashEntry.create({
        data: {
          pettyCashNo: 'PC-KHI-2026-001',
          branchId: khi.id,
          entryDate: new Date('2026-09-18'),
          categoryId: stationery.id,
          description: 'Seed stationery purchase',
          entryType: 'out',
          principal: 4500,
          salesTax: 0,
          srbSst: 0,
          gst: 500,
          incomeTax: 0,
          total: 5000,
          createdById: admin.id,
        },
      });
      if (cashGl && opexGl && inputTaxGl) {
        const jeNo = 'JE-2026-M7-PC01';
        if (!(await prisma.journalEntry.findUnique({
          where: {
            tenantId_entryNo: { tenantId: DEFAULT_TENANT_ID, entryNo: jeNo },
          },
        }))) {
          await prisma.journalEntry.create({
            data: {
              entryNo: jeNo,
              entryDate: new Date('2026-09-18'),
              branchId: khi.id,
              description: 'Petty cash expense — Stationery',
              approvalStatus: 'Approved',
              sourceType: 'PettyCash',
              sourceId: pc.id,
              isAutoPosted: true,
              postedAt: new Date(),
              createdById: admin.id,
              lines: {
                create: [
                  { lineNo: 1, glAccountId: opexGl.id, debit: 4500, credit: 0 },
                  { lineNo: 2, glAccountId: inputTaxGl.id, debit: 500, credit: 0 },
                  { lineNo: 3, glAccountId: cashGl.id, debit: 0, credit: 5000 },
                ],
              },
            },
          });
        }
      }
    }
  }

  if (admin && khi && officeRent && rentVendor && khiBank) {
    const existingEx = await prisma.expense.findFirst({
      where: { vendorName: 'Rent Properties', principal: 200000 },
    });
    if (!existingEx) {
      const expense = await prisma.expense.create({
        data: {
          expenseNo: 'EXP-KHI-2026-001',
          branchId: khi.id,
          vendorId: rentVendor.id,
          vendorName: rentVendor.name,
          categoryId: officeRent.id,
          expenseDate: new Date('2026-09-10'),
          principal: 200000,
          salesTax: 0,
          srbSst: 0,
          gst: 0,
          incomeTax: 0,
          total: 200000,
          paymentModeCode: 'Bank',
          bankAccountId: khiBank.id,
          approvalStatus: 'Approved',
          requestedById: admin.id,
          approvedById: admin.id,
          approvedAt: new Date(),
        },
      });
      if (opexGl && bankGlM7) {
        const jeNo = 'JE-2026-M7-EX01';
        if (!(await prisma.journalEntry.findUnique({
          where: {
            tenantId_entryNo: { tenantId: DEFAULT_TENANT_ID, entryNo: jeNo },
          },
        }))) {
          await prisma.journalEntry.create({
            data: {
              entryNo: jeNo,
              entryDate: new Date('2026-09-10'),
              branchId: khi.id,
              description: 'Expense payment — Rent Properties (Office Rent)',
              approvalStatus: 'Approved',
              sourceType: 'Expense',
              sourceId: expense.id,
              isAutoPosted: true,
              postedAt: new Date(),
              createdById: admin.id,
              lines: {
                create: [
                  { lineNo: 1, glAccountId: opexGl.id, debit: 200000, credit: 0 },
                  { lineNo: 2, glAccountId: bankGlM7.id, debit: 0, credit: 200000 },
                ],
              },
            },
          });
        }
      }
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: khiBank.id,
          txnDate: new Date('2026-09-10'),
          txnType: 'withdrawal',
          description: 'Expense — Rent Properties',
          amount: 200000,
          currencyCode: 'PKR',
          reconciliationStatus: 'Matched',
          sourceType: 'Expense',
          sourceId: expense.id,
        },
      });
    }

    const existingChq = await prisma.cheque.findFirst({
      where: { chequeNo: 'CHQ-M7-0001', bankAccountId: khiBank.id },
    });
    if (!existingChq) {
      await prisma.cheque.create({
        data: {
          chequeNo: 'CHQ-M7-0001',
          bankAccountId: khiBank.id,
          payee: 'Office Mart',
          amount: 25000,
          issueDate: new Date('2026-09-12'),
          status: 'Issued',
        },
      });
    }
  }

  if (admin && khi && khiBank && pkrOp && cashGl && bankGlM7) {
    const existingContra = await prisma.contraEntry.findFirst({
      where: { amount: 100000, contraType: 'CashBank', branchId: khi.id },
    });
    if (!existingContra) {
      const contra = await prisma.contraEntry.create({
        data: {
          contraNo: 'CE-2026-001',
          branchId: khi.id,
          entryDate: new Date('2026-09-20'),
          contraType: 'CashBank',
          fromIsCash: true,
          toIsCash: false,
          toBankAccountId: khiBank.id,
          amount: 100000,
          createdById: admin.id,
        },
      });
      const jeNo = 'JE-2026-M7-CT01';
      let jeId: string | undefined;
      if (!(await prisma.journalEntry.findUnique({
          where: {
            tenantId_entryNo: { tenantId: DEFAULT_TENANT_ID, entryNo: jeNo },
          },
        }))) {
        const je = await prisma.journalEntry.create({
          data: {
            entryNo: jeNo,
            entryDate: new Date('2026-09-20'),
            branchId: khi.id,
            description: 'Contra CashBank — Cash in Hand → Karachi Branch Account',
            approvalStatus: 'Approved',
            sourceType: 'Contra',
            sourceId: contra.id,
            isAutoPosted: true,
            postedAt: new Date(),
            createdById: admin.id,
            lines: {
              create: [
                { lineNo: 1, glAccountId: bankGlM7.id, debit: 100000, credit: 0 },
                { lineNo: 2, glAccountId: cashGl.id, debit: 0, credit: 100000 },
              ],
            },
          },
        });
        jeId = je.id;
      }
      if (jeId) {
        await prisma.contraEntry.update({
          where: { id: contra.id },
          data: { journalEntryId: jeId },
        });
      }
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: khiBank.id,
          txnDate: new Date('2026-09-20'),
          txnType: 'deposit',
          description: 'Contra in ← Cash in Hand',
          amount: 100000,
          currencyCode: 'PKR',
          reconciliationStatus: 'Matched',
          sourceType: 'Contra',
          sourceId: contra.id,
        },
      });
    }

    // Sample unmatched deposit for reconciliation UI
    const existingDep = await prisma.bankTransaction.findFirst({
      where: { description: 'Seed unmatched deposit', bankAccountId: khiBank.id },
    });
    if (!existingDep) {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: khiBank.id,
          txnDate: new Date('2026-09-21'),
          txnType: 'deposit',
          description: 'Seed unmatched deposit',
          amount: 75000,
          currencyCode: 'PKR',
          reconciliationStatus: 'Unmatched',
          sourceType: 'Manual',
        },
      });
    }
  }

  // ── M8 sample manual journal (approved) ───────────────────────────────────
  if (admin && khi && cashGl && bankGlM7) {
    const existingManual = await prisma.journalEntry.findUnique({
      where: {
        tenantId_entryNo: {
          tenantId: DEFAULT_TENANT_ID,
          entryNo: 'JE-2026-M8-MAN01',
        },
      },
    });
    if (!existingManual) {
      const manual = await prisma.journalEntry.create({
        data: {
          entryNo: 'JE-2026-M8-MAN01',
          entryDate: new Date('2026-09-23'),
          branchId: khi.id,
          description: 'Seed manual adjustment — cash float',
          approvalStatus: 'Approved',
          sourceType: 'Manual',
          isAutoPosted: false,
          postedAt: new Date(),
          createdById: admin.id,
          approvedById: admin.id,
          lines: {
            create: [
              { lineNo: 1, glAccountId: cashGl.id, debit: 25000, credit: 0 },
              { lineNo: 2, glAccountId: bankGlM7.id, debit: 0, credit: 25000 },
            ],
          },
        },
      });
      await prisma.journalEntry.update({
        where: { id: manual.id },
        data: { sourceId: manual.id },
      });
    }
  }

  // ── M9 sample tax sources (expense taxes, GST output adj, salary tax) ─────
  const marketingCat = await prisma.expenseCategory.findFirst({
    where: { name: { contains: 'Marketing', mode: 'insensitive' } },
  });
  const anyExpenseCat =
    marketingCat ??
    (await prisma.expenseCategory.findFirst({ orderBy: { name: 'asc' } }));

  if (admin && khi && anyExpenseCat && khiBank) {
    const existingTaxEx = await prisma.expense.findFirst({
      where: { vendorName: 'Print House', principal: 10000 },
    });
    if (!existingTaxEx) {
      const expense = await prisma.expense.create({
        data: {
          expenseNo: 'EXP-KHI-2026-002',
          branchId: khi.id,
          vendorName: 'Print House',
          categoryId: anyExpenseCat.id,
          expenseDate: new Date('2026-09-25'),
          principal: 10000,
          salesTax: 0,
          srbSst: 1300,
          gst: 1700,
          incomeTax: 200,
          total: 13200,
          paymentModeCode: 'Bank',
          bankAccountId: khiBank.id,
          approvalStatus: 'Approved',
          requestedById: admin.id,
          approvedById: admin.id,
          approvedAt: new Date(),
        },
      });
      const taxPayableGl = await prisma.glAccount.findUnique({
        where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: '2200' } },
      });
      if (opexGl && bankGlM7 && inputTaxGl && taxPayableGl) {
        const jeNo = 'JE-2026-M9-EX01';
        if (!(await prisma.journalEntry.findUnique({
          where: {
            tenantId_entryNo: { tenantId: DEFAULT_TENANT_ID, entryNo: jeNo },
          },
        }))) {
          // principal 10000 OpEx; input tax 3000; Cr WHT 200 + Cr Bank 12800
          await prisma.journalEntry.create({
            data: {
              entryNo: jeNo,
              entryDate: new Date('2026-09-25'),
              branchId: khi.id,
              description: 'Expense — Print House (M9 tax sample)',
              approvalStatus: 'Approved',
              sourceType: 'Expense',
              sourceId: expense.id,
              isAutoPosted: true,
              postedAt: new Date(),
              createdById: admin.id,
              lines: {
                create: [
                  { lineNo: 1, glAccountId: opexGl.id, debit: 10000, credit: 0 },
                  { lineNo: 2, glAccountId: inputTaxGl.id, debit: 3000, credit: 0 },
                  { lineNo: 3, glAccountId: taxPayableGl.id, debit: 0, credit: 200 },
                  { lineNo: 4, glAccountId: bankGlM7.id, debit: 0, credit: 12800 },
                ],
              },
            },
          });
        }
      }
    }
  }

  if (admin && khi) {
    const existingGstOut = await prisma.taxRecord.findFirst({
      where: {
        taxType: 'GstOutput',
        period: '2026-09',
        branchId: khi.id,
        sourceType: 'Manual',
      },
    });
    if (!existingGstOut) {
      const id = randomUUID();
      await prisma.taxRecord.create({
        data: {
          id,
          taxType: 'GstOutput',
          period: '2026-09',
          branchId: khi.id,
          amount: 9500,
          sourceType: 'Manual',
          sourceId: id,
        },
      });
    }

    let emp = await prisma.employee.findFirst({
      where: { fullName: 'Seed Accountant (M9)' },
    });
    if (!emp) {
      emp = await prisma.employee.create({
        data: {
          employeeNo: 'EMP-001',
          fullName: 'Seed Accountant (M9)',
          branchId: khi.id,
          designation: 'Accountant',
          basicSalary: 120000,
          allowances: 20000,
          isActive: true,
        },
      });
    } else if (!(emp as { employeeNo?: string }).employeeNo) {
      await prisma.employee.update({
        where: { id: emp.id },
        data: { employeeNo: 'EMP-001' },
      });
    }

    let run = await prisma.payrollRun.findUnique({
      where: {
        branchId_period_source: {
          branchId: khi.id,
          period: '2026-09',
          source: 'Internal',
        },
      },
    });
    if (!run) {
      run = await prisma.payrollRun.create({
        data: {
          runNo: 'PR-KHI-2026-001',
          branchId: khi.id,
          period: '2026-09',
          source: 'Internal',
          status: 'Processed',
          runDate: new Date('2026-09-28'),
          employeeCount: 1,
          totalGross: 140000,
          totalTax: 15750,
          totalNet: 124250,
          processedById: admin.id,
        },
      });
    } else if (Number(run.totalTax) === 8500) {
      // Align legacy M9 sample with FE/backend computeSalary formula
      run = await prisma.payrollRun.update({
        where: { id: run.id },
        data: { totalTax: 15750, totalNet: 124250 },
      });
    }
    const existingLine = await prisma.payrollLine.findUnique({
      where: {
        payrollRunId_employeeId: {
          payrollRunId: run.id,
          employeeId: emp.id,
        },
      },
    });
    if (!existingLine) {
      await prisma.payrollLine.create({
        data: {
          payrollRunId: run.id,
          employeeId: emp.id,
          basicSalary: 120000,
          allowances: 20000,
          grossSalary: 140000,
          salaryTax: 15750,
          netSalary: 124250,
          reimbursements: 0,
          totalPayable: 124250,
        },
      });
    } else if (Number(existingLine.salaryTax) === 8500) {
      await prisma.payrollLine.update({
        where: { id: existingLine.id },
        data: {
          salaryTax: 15750,
          netSalary: 124250,
          totalPayable: 124250,
        },
      });
    }
  }

  // ── M10 salary slabs + extra employees / reimbursement ────────────────────
  const slabCount = await prisma.salaryTaxSlab.count();
  if (slabCount === 0) {
    const from = new Date('2025-07-01');
    // FBR salaried slabs TY 2026-27 (ratePercent = marginal %; fixed base is in code)
    await prisma.salaryTaxSlab.createMany({
      data: [
        { minAnnual: 0, maxAnnual: 600000, ratePercent: 0, effectiveFrom: from },
        { minAnnual: 600000.01, maxAnnual: 1200000, ratePercent: 1, effectiveFrom: from },
        { minAnnual: 1200000.01, maxAnnual: 2200000, ratePercent: 11, effectiveFrom: from },
        { minAnnual: 2200000.01, maxAnnual: 3200000, ratePercent: 20, effectiveFrom: from },
        { minAnnual: 3200000.01, maxAnnual: 4100000, ratePercent: 25, effectiveFrom: from },
        { minAnnual: 4100000.01, maxAnnual: 5600000, ratePercent: 29, effectiveFrom: from },
        { minAnnual: 5600000.01, maxAnnual: 7000000, ratePercent: 32, effectiveFrom: from },
        { minAnnual: 7000000.01, maxAnnual: null, ratePercent: 35, effectiveFrom: from },
      ],
    });
  }

  if (admin && khi && lhr) {
    const extras = [
      {
        employeeNo: 'EMP-002',
        fullName: 'Fatima Noor',
        branchId: khi.id,
        designation: 'Senior Counsellor',
        basicSalary: 95000,
        allowances: 20000,
        email: 'fatima.payroll@saa.com',
      },
      {
        employeeNo: 'EMP-003',
        fullName: 'Sara Malik',
        branchId: lhr.id,
        designation: 'Senior Accountant',
        basicSalary: 120000,
        allowances: 25000,
        email: 'sara.payroll@saa.com',
      },
    ];
    for (const e of extras) {
      const found = await prisma.employee.findFirst({
        where: { fullName: e.fullName, branchId: e.branchId, deletedAt: null },
      });
      if (found) {
        await prisma.employee.update({ where: { id: found.id }, data: { ...e, isActive: true } });
      } else {
        await prisma.employee.create({ data: { ...e, isActive: true } });
      }
    }

    const fatima = await prisma.employee.findFirst({
      where: { fullName: 'Fatima Noor', branchId: khi.id, deletedAt: null },
    });
    if (fatima) {
      const existingRb = await prisma.reimbursement.findFirst({
        where: {
          employeeId: fatima.id,
          description: 'Seed travel claim (M10)',
        },
      });
      if (!existingRb) {
        await prisma.reimbursement.create({
          data: {
            reimbursementNo: 'REIM-2026-001',
            employeeId: fatima.id,
            branchId: khi.id,
            reimbursementType: 'Travel',
            amount: 12500,
            reimbursementDate: new Date('2026-10-01'),
            status: 'Approved',
            description: 'Seed travel claim (M10)',
            requestedById: admin.id,
          },
        });
      }
    }
  }

  // ── M11 pending expense approval + sample document ────────────────────────
  const ahmed = await prisma.user.findUnique({ where: { email: 'ahmed@saa.com' } });
  const utilitiesCat =
    (await prisma.expenseCategory.findFirst({
      where: { name: { contains: 'Utilit', mode: 'insensitive' } },
    })) ??
    (await prisma.expenseCategory.findFirst({ orderBy: { name: 'asc' } }));

  if (admin && khi && ahmed && utilitiesCat && khiBank) {
    let pendingEx = await prisma.expense.findFirst({
      where: {
        vendorName: 'KE Electric',
        principal: 45000,
        approvalStatus: 'Pending',
      },
    });
    if (!pendingEx) {
      pendingEx = await prisma.expense.create({
        data: {
          expenseNo: 'EXP-KHI-2026-003',
          branchId: khi.id,
          vendorName: 'KE Electric',
          categoryId: utilitiesCat.id,
          expenseDate: new Date('2026-10-05'),
          principal: 45000,
          salesTax: 0,
          srbSst: 0,
          gst: 0,
          incomeTax: 0,
          total: 45000,
          paymentModeCode: 'Bank',
          bankAccountId: khiBank.id,
          approvalStatus: 'Pending',
          requestedById: ahmed.id,
        },
      });
    }
    const existingAp = await prisma.approval.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'Expense',
          sourceId: pendingEx.id,
        },
      },
    });
    if (!existingAp) {
      await prisma.approval.create({
        data: {
          approvalNo: 'APR-2026-001',
          approvalType: 'Expense',
          title: `KE Electric — ${utilitiesCat.name}`,
          amount: 45000,
          branchId: khi.id,
          requestedById: ahmed.id,
          requestDate: new Date('2026-10-05'),
          status: 'Pending',
          sourceType: 'Expense',
          sourceId: pendingEx.id,
        },
      });
    }

    const existingDoc = await prisma.document.findFirst({
      where: { name: 'Seed invoice KE-Electric.pdf' },
    });
    if (!existingDoc) {
      const { mkdirSync, writeFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const uploadRoot = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
      if (!existsSync(uploadRoot)) mkdirSync(uploadRoot, { recursive: true });
      const docId = randomUUID();
      const storageKey = `${docId}.txt`;
      writeFileSync(
        join(uploadRoot, storageKey),
        'Seed document for M11 — KE Electric bill placeholder\n',
      );
      await prisma.document.create({
        data: {
          id: docId,
          name: 'Seed invoice KE-Electric.pdf',
          docType: 'Bill',
          linkedType: 'Expense',
          linkedId: pendingEx.id,
          storageKey,
          mimeType: 'text/plain',
          sizeBytes: BigInt(64),
          uploadedById: admin.id,
        },
      });
    }
  }

  // ── MT3: DEMO isolation samples (after shared currencies/countries exist) ─
  {
    const { provisionTenantTemplate } = await import(
      '../src/tenants/tenant-template.service'
    );
    await provisionTenantTemplate(prisma, DEMO_TENANT_ID, {
      orgName: 'Demo Agency (MT4)',
      whtRatePercent: 2.5,
      fiscalPeriodLockedUntil: '2025-12-31',
      enabledCurrencies: ['PKR', 'GBP', 'USD'],
    });

    const demoAdminUser = await prisma.user.findUnique({
      where: { email: 'admin@demo.local' },
    });
    let demoUni = await prisma.university.findFirst({
      where: { tenantId: DEMO_TENANT_ID, name: 'Demo Isolation University' },
    });
    if (!demoUni) {
      demoUni = await prisma.university.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          universityNo: 'UNI-001',
          name: 'Demo Isolation University',
          countryName: 'UK',
          countryCode: 'GB',
          defaultCommissionRate: 10,
          currencyCode: 'GBP',
          isActive: true,
        },
      });
    }
    let demoCourse = await prisma.course.findFirst({
      where: { tenantId: DEMO_TENANT_ID, name: 'MSc Demo', deletedAt: null },
    });
    if (!demoCourse) {
      demoCourse = await prisma.course.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          name: 'MSc Demo',
          isActive: true,
        },
      });
    }
    if (demoAdminUser && demoUni && demoCourse) {
      await prisma.student.upsert({
        where: {
          tenantId_studentCode: {
            tenantId: DEMO_TENANT_ID,
            studentCode: 'DEMO-STU-001',
          },
        },
        create: {
          tenantId: DEMO_TENANT_ID,
          studentCode: 'DEMO-STU-001',
          fullName: 'Demo Only Student',
          cnicPassport: '99999-9999999-9',
          contact: '+92 300 0000001',
          email: 'demo.student@demo.local',
          branchId: demoBranch.id,
          counsellorId: demoAdminUser.id,
          country: 'UK',
          universityId: demoUni.id,
          courseId: demoCourse.id,
          intake: 'Sep-2026',
          applicationStatus: 'Applied',
          tuitionFee: 10000,
          scholarship: 0,
          expectedCommissionRate: 10,
          currencyCode: 'GBP',
          createdById: demoAdminUser.id,
        },
        update: {
          fullName: 'Demo Only Student',
          deletedAt: null,
          universityId: demoUni.id,
          courseId: demoCourse.id,
          branchId: demoBranch.id,
          counsellorId: demoAdminUser.id,
        },
      });
    }
  }

  console.log(
    'Seed complete (includes M3–M11: through approvals / documents / audit).',
  );
  console.log('Demo logins use emails like admin@saa.com with the seed password above.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
