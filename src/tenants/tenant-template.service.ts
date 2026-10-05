import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { COA_SEED } from '../masters/masters.service';
import { TenantContext } from '../common/tenant-context';

export type TenantTemplateOptions = {
  orgName: string;
  whtRatePercent?: number;
  fiscalPeriodLockedUntil?: string | null;
  enabledCurrencies?: string[];
};

const DEFAULT_PETTY_CATS = [
  'Stationery',
  'Refreshments',
  'Courier',
  'Printing',
  'Transport',
  'Utilities',
  'Maintenance',
  'Imprest',
] as const;

const DEFAULT_EXPENSE_CATS = [
  'Office Rent',
  'Utilities',
  'Marketing',
  'Travel',
  'Salaries Related',
  'Professional Fees',
  'IT & Software',
  'Miscellaneous',
] as const;

const DEFAULT_FX: Array<{ code: string; rate: number }> = [
  { code: 'PKR', rate: 1 },
  { code: 'GBP', rate: 355 },
  { code: 'USD', rate: 278 },
  { code: 'CAD', rate: 205 },
  { code: 'AUD', rate: 185 },
  { code: 'EUR', rate: 300 },
];

const DEFAULT_COUNTRIES: Array<{ name: string; isoCode: string }> = [
  { name: 'UK', isoCode: 'GB' },
  { name: 'USA', isoCode: 'US' },
  { name: 'Canada', isoCode: 'CA' },
  { name: 'Australia', isoCode: 'AU' },
  { name: 'Germany', isoCode: 'DE' },
  { name: 'Ireland', isoCode: 'IE' },
  { name: 'New Zealand', isoCode: 'NZ' },
];

/**
 * Pure provisioner (usable from Nest + seed). Does **not** copy transactional
 * data from another tenant — only template masters/settings/COA/FX/categories.
 */
export async function provisionTenantTemplate(
  prisma: PrismaClient,
  tenantId: string,
  options: TenantTemplateOptions,
): Promise<{
  settings: number;
  expenseCategories: number;
  pettyCategories: number;
  countries: number;
  glAccounts: number;
  fxRates: number;
}> {
  const wht = options.whtRatePercent ?? 1;
  const fiscal =
    options.fiscalPeriodLockedUntil === undefined
      ? null
      : options.fiscalPeriodLockedUntil;
  const currencies = options.enabledCurrencies ?? [
    'PKR',
    'GBP',
    'USD',
    'CAD',
    'AUD',
    'EUR',
  ];

  const settings: Array<{ key: string; value: unknown }> = [
    { key: 'org_name', value: options.orgName },
    { key: 'wht_rate_percent', value: wht },
    { key: 'fiscal_period_locked_until', value: fiscal },
    { key: 'enabled_currencies', value: currencies },
    { key: 'invoice_document_title', value: 'Commission Invoice' },
    { key: 'invoice_footer', value: 'Thank you for your business.' },
    { key: 'invoice_accent_color', value: '#0f766e' },
    {
      key: 'invoice_email_subject',
      value: 'Commission Invoice {{invoiceNo}}',
    },
    {
      key: 'invoice_email_body',
      value:
        'Dear Sir/Madam,\n\n' +
        'Please find commission invoice {{invoiceNo}} dated {{invoiceDate}}' +
        ' for {{students}}{{universities}}.\n\n' +
        'Total amount: {{amount}}.\n\n' +
        'Kind regards,\n{{orgName}}',
    },
  ];

  let settingsN = 0;
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId, key: s.key } },
      create: {
        tenantId,
        key: s.key,
        value: s.value as object,
      },
      update: { value: s.value as object },
    });
    settingsN += 1;
  }

  let expenseCategories = 0;
  for (const name of DEFAULT_EXPENSE_CATS) {
    await prisma.expenseCategory.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, isActive: true },
      update: { isActive: true },
    });
    expenseCategories += 1;
  }

  let pettyCategories = 0;
  for (const name of DEFAULT_PETTY_CATS) {
    await prisma.pettyCashCategory.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, isActive: true },
      update: { isActive: true },
    });
    pettyCategories += 1;
  }

  let countries = 0;
  for (const c of DEFAULT_COUNTRIES) {
    await prisma.tenantCountry.upsert({
      where: { tenantId_name: { tenantId, name: c.name } },
      create: {
        tenantId,
        name: c.name,
        isoCode: c.isoCode,
        isActive: true,
      },
      update: { isActive: true, isoCode: c.isoCode },
    });
    countries += 1;
  }

  const byCode = new Map<string, string>();
  let glAccounts = 0;
  for (const item of COA_SEED) {
    const parentId = item.parentCode
      ? byCode.get(item.parentCode) ?? null
      : null;
    const row = await prisma.glAccount.upsert({
      where: { tenantId_code: { tenantId, code: item.code } },
      create: {
        tenantId,
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
    byCode.set(item.code, row.id);
    glAccounts += 1;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let fxRates = 0;
  for (const fx of DEFAULT_FX) {
    await prisma.fxRate.upsert({
      where: {
        tenantId_currencyCode_effectiveDate: {
          tenantId,
          currencyCode: fx.code,
          effectiveDate: today,
        },
      },
      create: {
        tenantId,
        currencyCode: fx.code,
        rateToPkr: fx.rate,
        effectiveDate: today,
      },
      update: { rateToPkr: fx.rate },
    });
    fxRates += 1;
  }

  return {
    settings: settingsN,
    expenseCategories,
    pettyCategories,
    countries,
    glAccounts,
    fxRates,
  };
}

@Injectable()
export class TenantTemplateService {
  private readonly logger = new Logger(TenantTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Provision template for `tenantId`. Clears tenant ALS so the Nest Prisma
   * extension does not rewrite explicit tenantId arguments.
   */
  async provision(tenantId: string, options: TenantTemplateOptions) {
    TenantContext.enter({ tenantId: null, isPlatform: true });
    const result = await provisionTenantTemplate(
      this.prisma as unknown as PrismaClient,
      tenantId,
      options,
    );
    this.logger.log(
      `Provisioned template for tenant ${tenantId}: ${JSON.stringify(result)}`,
    );
    return result;
  }
}
