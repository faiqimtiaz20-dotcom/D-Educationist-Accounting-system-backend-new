import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { currentTenantId } from '../common/tenant-scope';
import {
  CreateBankAccountDto,
  CreateCategoryDto,
  CreateGlAccountDto,
  CreateSubAgentDto,
  CreateUniversityDto,
  CreateVendorDto,
  UpdateBankAccountDto,
  UpdateCategoryDto,
  UpdateCurrencyDto,
  UpdateSubAgentDto,
  UpdateUniversityDto,
  UpdateVendorDto,
  UpsertFxRateDto,
} from './dto/masters.dto';
import { nextMasterNo } from '../common/document-numbers';

/** Flattened COA seed matching frontend src/lib/coa.ts */
export const COA_SEED: Array<{
  code: string;
  name: string;
  accountType: GlAccountType;
  parentCode: string | null;
  isPostable: boolean;
  sortOrder: number;
}> = [
  { code: '1000', name: 'Assets', accountType: 'asset', parentCode: null, isPostable: false, sortOrder: 1 },
  { code: '1100', name: 'Cash & Bank', accountType: 'asset', parentCode: '1000', isPostable: false, sortOrder: 2 },
  { code: '1110', name: 'Cash in Hand', accountType: 'asset', parentCode: '1100', isPostable: true, sortOrder: 3 },
  { code: '1120', name: 'Bank Accounts', accountType: 'asset', parentCode: '1100', isPostable: true, sortOrder: 4 },
  { code: '1200', name: 'Accounts Receivable', accountType: 'asset', parentCode: '1000', isPostable: true, sortOrder: 5 },
  { code: '1210', name: 'WHT Receivable', accountType: 'asset', parentCode: '1000', isPostable: true, sortOrder: 6 },
  { code: '1220', name: 'Unallocated Remittances', accountType: 'liability', parentCode: '2000', isPostable: true, sortOrder: 9 },
  { code: '1300', name: 'Prepaid Expenses', accountType: 'asset', parentCode: '1000', isPostable: true, sortOrder: 7 },
  { code: '1310', name: 'Input Tax Credit', accountType: 'asset', parentCode: '1000', isPostable: true, sortOrder: 8 },
  { code: '2000', name: 'Liabilities', accountType: 'liability', parentCode: null, isPostable: false, sortOrder: 10 },
  { code: '2100', name: 'Accounts Payable', accountType: 'liability', parentCode: '2000', isPostable: true, sortOrder: 11 },
  { code: '2200', name: 'Tax Payable', accountType: 'liability', parentCode: '2000', isPostable: true, sortOrder: 12 },
  { code: '2300', name: 'Salary Payable', accountType: 'liability', parentCode: '2000', isPostable: true, sortOrder: 13 },
  { code: '3000', name: 'Equity', accountType: 'equity', parentCode: null, isPostable: true, sortOrder: 20 },
  { code: '4000', name: 'Revenue', accountType: 'income', parentCode: null, isPostable: false, sortOrder: 30 },
  { code: '4100', name: 'Commission Income', accountType: 'income', parentCode: '4000', isPostable: true, sortOrder: 31 },
  { code: '4200', name: 'Other Income', accountType: 'income', parentCode: '4000', isPostable: true, sortOrder: 32 },
  { code: '4300', name: 'FX Gain', accountType: 'income', parentCode: '4000', isPostable: true, sortOrder: 33 },
  { code: '5000', name: 'Expenses', accountType: 'expense', parentCode: null, isPostable: false, sortOrder: 40 },
  { code: '5100', name: 'Sub-Agent Commission', accountType: 'expense', parentCode: '5000', isPostable: true, sortOrder: 41 },
  { code: '5200', name: 'Operating Expenses', accountType: 'expense', parentCode: '5000', isPostable: true, sortOrder: 42 },
  { code: '5300', name: 'Payroll', accountType: 'expense', parentCode: '5000', isPostable: true, sortOrder: 43 },
  { code: '5400', name: 'Depreciation', accountType: 'expense', parentCode: '5000', isPostable: true, sortOrder: 44 },
  { code: '5500', name: 'FX Loss', accountType: 'expense', parentCode: '5000', isPostable: true, sortOrder: 45 },
];

@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Universities ──────────────────────────────────────────────────────────

  listUniversities(includeInactive = false) {
    return this.prisma.university.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async getUniversity(id: string) {
    const row = await this.prisma.university.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('University not found');
    return row;
  }

  async createUniversity(dto: CreateUniversityDto, actorId: string) {
    await this.ensureCurrency(dto.currencyCode);
    const countryCode = await this.ensureCountry(
      dto.countryName.trim(),
      dto.countryCode,
    );
    const row = await this.prisma.$transaction(async (tx) => {
      const universityNo = await nextMasterNo(tx, {
        model: 'university',
        field: 'universityNo',
        prefix: 'UNI-',
      });
      return tx.university.create({
        data: {
          universityNo,
          name: dto.name.trim(),
          countryName: dto.countryName.trim(),
          countryCode,
          defaultCommissionRate: dto.defaultCommissionRate,
          currencyCode: dto.currencyCode.toUpperCase(),
          isActive: dto.isActive ?? true,
        },
      });
    });
    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      module: 'Settings',
      entityType: 'University',
      entityId: row.id,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async updateUniversity(id: string, dto: UpdateUniversityDto, actorId: string) {
    const before = await this.getUniversity(id);
    if (dto.currencyCode) await this.ensureCurrency(dto.currencyCode);
    let countryCode: string | null | undefined;
    if (dto.countryName !== undefined || dto.countryCode !== undefined) {
      countryCode = await this.ensureCountry(
        (dto.countryName ?? before.countryName).trim(),
        dto.countryCode !== undefined ? dto.countryCode : before.countryCode,
      );
    }
    const row = await this.prisma.university.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.countryName !== undefined
          ? { countryName: dto.countryName.trim() }
          : {}),
        ...(countryCode !== undefined ? { countryCode } : {}),
        ...(dto.defaultCommissionRate !== undefined
          ? { defaultCommissionRate: dto.defaultCommissionRate }
          : {}),
        ...(dto.currencyCode !== undefined
          ? { currencyCode: dto.currencyCode.toUpperCase() }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'University',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async deleteUniversity(id: string, actorId: string) {
    const before = await this.getUniversity(id);
    await this.prisma.university.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'University',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
    });
    return { success: true };
  }

  // ── Sub-agents ────────────────────────────────────────────────────────────

  private async nextSubAgentNo(tx: Prisma.TransactionClient = this.prisma) {
    const latest = await tx.subAgent.findFirst({
      where: { subAgentNo: { startsWith: 'SA-' } },
      orderBy: { subAgentNo: 'desc' },
      select: { subAgentNo: true },
    });
    let next = 1;
    if (latest?.subAgentNo) {
      const n = parseInt(latest.subAgentNo.slice(3), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `SA-${String(next).padStart(3, '0')}`;
  }

  listSubAgents(includeInactive = false) {
    return this.prisma.subAgent.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ subAgentNo: 'asc' }, { name: 'asc' }],
    });
  }

  async getSubAgent(id: string) {
    const row = await this.prisma.subAgent.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Sub-agent not found');
    return row;
  }

  async createSubAgent(dto: CreateSubAgentDto, actorId: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      const subAgentNo = await this.nextSubAgentNo(tx);
      return tx.subAgent.create({
        data: {
          subAgentNo,
          name: dto.name.trim(),
          ntn: dto.ntn?.trim() || null,
          email: dto.email?.trim().toLowerCase() || null,
          contact: dto.contact?.trim() || null,
          accountTitle: dto.accountTitle?.trim() || null,
          iban: dto.iban?.trim() || null,
          accountNo: dto.accountNo?.trim() || null,
          defaultRatePercent: dto.defaultRatePercent,
          isActive: dto.isActive ?? true,
        },
      });
    });
    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      module: 'Sub-Agents',
      entityType: 'SubAgent',
      entityId: row.id,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async updateSubAgent(id: string, dto: UpdateSubAgentDto, actorId: string) {
    const before = await this.getSubAgent(id);
    const row = await this.prisma.subAgent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.ntn !== undefined ? { ntn: dto.ntn?.trim() || null } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.trim().toLowerCase() || null }
          : {}),
        ...(dto.contact !== undefined
          ? { contact: dto.contact?.trim() || null }
          : {}),
        ...(dto.accountTitle !== undefined
          ? { accountTitle: dto.accountTitle?.trim() || null }
          : {}),
        ...(dto.iban !== undefined ? { iban: dto.iban?.trim() || null } : {}),
        ...(dto.accountNo !== undefined
          ? { accountNo: dto.accountNo?.trim() || null }
          : {}),
        ...(dto.defaultRatePercent !== undefined
          ? { defaultRatePercent: dto.defaultRatePercent }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Sub-Agents',
      entityType: 'SubAgent',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async deleteSubAgent(id: string, actorId: string) {
    const before = await this.getSubAgent(id);
    await this.prisma.subAgent.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Sub-Agents',
      entityType: 'SubAgent',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
    });
    return { success: true };
  }

  // ── Vendors ───────────────────────────────────────────────────────────────

  listVendors(includeInactive = false) {
    return this.prisma.vendor.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async getVendor(id: string) {
    const row = await this.prisma.vendor.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Vendor not found');
    return row;
  }

  async createVendor(dto: CreateVendorDto, actorId: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      const vendorNo = await nextMasterNo(tx, {
        model: 'vendor',
        field: 'vendorNo',
        prefix: 'VEN-',
      });
      return tx.vendor.create({
        data: {
          vendorNo,
          name: dto.name.trim(),
          ntn: dto.ntn?.trim() || null,
          contact: dto.contact?.trim() || null,
          email: dto.email?.trim().toLowerCase() || null,
          isActive: dto.isActive ?? true,
        },
      });
    });
    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      module: 'Settings',
      entityType: 'Vendor',
      entityId: row.id,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async updateVendor(id: string, dto: UpdateVendorDto, actorId: string) {
    const before = await this.getVendor(id);
    const row = await this.prisma.vendor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.ntn !== undefined ? { ntn: dto.ntn?.trim() || null } : {}),
        ...(dto.contact !== undefined
          ? { contact: dto.contact?.trim() || null }
          : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.trim().toLowerCase() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'Vendor',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async deleteVendor(id: string, actorId: string) {
    const before = await this.getVendor(id);
    await this.prisma.vendor.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'Vendor',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
    });
    return { success: true };
  }

  // ── Bank accounts ─────────────────────────────────────────────────────────

  listBankAccounts(scope: RequestBranchScope, includeInactive = false) {
    return this.prisma.bankAccount.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getBankAccount(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.bankAccount.findFirst({
      where: { id, deletedAt: null },
      include: { branch: { select: { id: true, code: true, name: true } } },
    });
    if (!row) throw new NotFoundException('Bank account not found');
    if (!scope.allBranches && row.branchId !== scope.branchId) {
      throw new NotFoundException('Bank account not found');
    }
    return row;
  }

  async createBankAccount(dto: CreateBankAccountDto, actorId: string) {
    await this.ensureCurrency(dto.currencyCode);
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, deletedAt: null },
    });
    if (!branch) throw new BadRequestException('Branch not found');

    const row = await this.prisma.bankAccount.create({
      data: {
        branchId: dto.branchId,
        name: dto.name.trim(),
        bankName: dto.bankName.trim(),
        accountNo: dto.accountNo.trim(),
        currencyCode: dto.currencyCode.toUpperCase(),
        openingBalance: dto.openingBalance ?? 0,
        isActive: dto.isActive ?? true,
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
    });
    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      module: 'Bank & Cash',
      entityType: 'BankAccount',
      entityId: row.id,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async updateBankAccount(
    id: string,
    dto: UpdateBankAccountDto,
    actorId: string,
    scope: RequestBranchScope,
  ) {
    const before = await this.getBankAccount(id, scope);
    if (dto.currencyCode) await this.ensureCurrency(dto.currencyCode);
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null },
      });
      if (!branch) throw new BadRequestException('Branch not found');
    }
    const row = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.bankName !== undefined ? { bankName: dto.bankName.trim() } : {}),
        ...(dto.accountNo !== undefined
          ? { accountNo: dto.accountNo.trim() }
          : {}),
        ...(dto.currencyCode !== undefined
          ? { currencyCode: dto.currencyCode.toUpperCase() }
          : {}),
        ...(dto.openingBalance !== undefined
          ? { openingBalance: dto.openingBalance }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Bank & Cash',
      entityType: 'BankAccount',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  async deleteBankAccount(
    id: string,
    actorId: string,
    scope: RequestBranchScope,
  ) {
    const before = await this.getBankAccount(id, scope);
    await this.prisma.bankAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Bank & Cash',
      entityType: 'BankAccount',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
    });
    return { success: true };
  }

  // ── Categories ────────────────────────────────────────────────────────────

  listExpenseCategories(includeInactive = false) {
    return this.prisma.expenseCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  listPettyCashCategories(includeInactive = false) {
    return this.prisma.pettyCashCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createExpenseCategory(dto: CreateCategoryDto, actorId: string) {
    try {
      const row = await this.prisma.expenseCategory.create({
        data: {
          name: dto.name.trim(),
          isActive: dto.isActive ?? true,
          glAccountId: dto.glAccountId || null,
        },
      });
      await this.audit.log({
        userId: actorId,
        action: 'CREATE',
        module: 'Settings',
        entityType: 'ExpenseCategory',
        entityId: row.id,
        afterData: row,
      });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }
      throw e;
    }
  }

  async updateExpenseCategory(
    id: string,
    dto: UpdateCategoryDto,
    actorId: string,
  ) {
    const before = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    const row = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.glAccountId !== undefined
          ? { glAccountId: dto.glAccountId || null }
          : {}),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'ExpenseCategory',
      entityId: id,
      beforeData: before,
      afterData: row,
    });
    return row;
  }

  async deleteExpenseCategory(id: string, actorId: string) {
    const before = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    await this.prisma.expenseCategory.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'ExpenseCategory',
      entityId: id,
      beforeData: before,
    });
    return { success: true };
  }

  async createPettyCashCategory(dto: CreateCategoryDto, actorId: string) {
    try {
      const row = await this.prisma.pettyCashCategory.create({
        data: {
          name: dto.name.trim(),
          isActive: dto.isActive ?? true,
        },
      });
      await this.audit.log({
        userId: actorId,
        action: 'CREATE',
        module: 'Settings',
        entityType: 'PettyCashCategory',
        entityId: row.id,
        afterData: row,
      });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }
      throw e;
    }
  }

  async updatePettyCashCategory(
    id: string,
    dto: UpdateCategoryDto,
    actorId: string,
  ) {
    const before = await this.prisma.pettyCashCategory.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Category not found');
    const row = await this.prisma.pettyCashCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'PettyCashCategory',
      entityId: id,
      beforeData: before,
      afterData: row,
    });
    return row;
  }

  async deletePettyCashCategory(id: string, actorId: string) {
    const before = await this.prisma.pettyCashCategory.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Category not found');
    await this.prisma.pettyCashCategory.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'PettyCashCategory',
      entityId: id,
      beforeData: before,
    });
    return { success: true };
  }

  // ── Currencies / FX / COA ─────────────────────────────────────────────────

  listCurrencies(enabledOnly = false) {
    return this.prisma.currency.findMany({
      where: enabledOnly ? { isEnabled: true } : undefined,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updateCurrency(code: string, dto: UpdateCurrencyDto, actorId: string) {
    const before = await this.prisma.currency.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('Currency not found');
    const row = await this.prisma.currency.update({
      where: { code },
      data: {
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.symbol !== undefined ? { symbol: dto.symbol } : {}),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'Currency',
      entityId: undefined,
      afterData: row,
      beforeData: before,
    });
    return row;
  }

  listFxRates() {
    return this.prisma.fxRate.findMany({
      orderBy: [{ effectiveDate: 'desc' }, { currencyCode: 'asc' }],
      take: 100,
    });
  }

  async upsertFxRate(dto: UpsertFxRateDto, actorId: string) {
    await this.ensureCurrency(dto.currencyCode);
    const tenantId = currentTenantId();
    const effectiveDate = dto.effectiveDate
      ? new Date(dto.effectiveDate)
      : new Date(new Date().toISOString().slice(0, 10));
    const row = await this.prisma.fxRate.upsert({
      where: {
        tenantId_currencyCode_effectiveDate: {
          tenantId,
          currencyCode: dto.currencyCode.toUpperCase(),
          effectiveDate,
        },
      },
      create: {
        tenantId,
        currencyCode: dto.currencyCode.toUpperCase(),
        rateToPkr: dto.rateToPkr,
        effectiveDate,
      },
      update: { rateToPkr: dto.rateToPkr },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'FxRate',
      entityId: row.id,
      afterData: row as unknown as Prisma.InputJsonValue,
    });
    return row;
  }

  listGlAccounts() {
    return this.prisma.glAccount.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        parent: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async createGlAccount(dto: CreateGlAccountDto, actorId: string) {
    const code = dto.code.trim();
    if (!code) throw new BadRequestException('Account code is required');

    const tenantId = currentTenantId();
    const existing = await this.prisma.glAccount.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (existing) {
      throw new ConflictException(`GL account code ${code} already exists`);
    }

    if (dto.parentId) {
      const parent = await this.prisma.glAccount.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new BadRequestException('Invalid parent account');
    }

    const row = await this.prisma.glAccount.create({
      data: {
        code,
        name: dto.name.trim(),
        accountType: dto.accountType,
        parentId: dto.parentId ?? null,
        isPostable: dto.isPostable ?? true,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: {
        parent: { select: { id: true, code: true, name: true } },
      },
    });

    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      module: 'Settings',
      entityType: 'GlAccount',
      entityId: row.id,
      afterData: { code: row.code, accountType: row.accountType },
    });

    return row;
  }

  async seedChartOfAccounts(actorId?: string) {
    const tenantId = currentTenantId();
    const byCode = new Map<string, string>();

    for (const item of COA_SEED) {
      const parentId = item.parentCode
        ? byCode.get(item.parentCode) ?? null
        : null;
      if (item.parentCode && !parentId) {
        throw new BadRequestException(
          `COA parent ${item.parentCode} missing for ${item.code}`,
        );
      }

      const row = await this.prisma.glAccount.upsert({
        where: {
          tenantId_code: { tenantId, code: item.code },
        },
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
    }

    if (actorId) {
      await this.audit.log({
        userId: actorId,
        action: 'UPDATE',
        module: 'Settings',
        entityType: 'GlAccount',
        afterData: { seeded: COA_SEED.length },
      });
    }

    return this.listGlAccounts();
  }

  private async ensureCurrency(code: string) {
    const c = await this.prisma.currency.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!c) throw new BadRequestException(`Unknown currency ${code}`);
  }

  /** Ensure Country row exists when a code is provided; returns normalized code or null. */
  private async ensureCountry(
    countryName: string,
    countryCode?: string | null,
  ): Promise<string | null> {
    const code = countryCode?.trim().toUpperCase() || null;
    if (!code) return null;
    await this.prisma.country.upsert({
      where: { code },
      create: { code, name: countryName || code },
      update: { name: countryName || code },
    });
    return code;
  }
}
