import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, ApprovalType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/cash.dto';
import { ApprovalsSyncService } from '../operations/approvals-sync.service';

const include = {
  category: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  bankAccount: { select: { id: true, name: true } },
  cheque: { select: { id: true, chequeNo: true, status: true } },
  paymentMode: { select: { code: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalLockService,
    private readonly gl: GlPostingService,
    private readonly approvalsSync: ApprovalsSyncService,
  ) {}

  private assertBranch(scope: RequestBranchScope, branchId: string) {
    if (!scope.allBranches && scope.branchId !== branchId) {
      throw new ForbiddenException('Cross-branch access is not allowed');
    }
  }

  private parseDate(raw: string) {
    const d = new Date(raw.slice(0, 10));
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date ${raw}`);
    }
    return d;
  }

  private totals(dto: {
    principal: number;
    salesTax?: number;
    srbSst?: number;
    gst?: number;
    incomeTax?: number;
  }) {
    const principal = round2(dto.principal);
    const salesTax = round2(dto.salesTax ?? 0);
    const srbSst = round2(dto.srbSst ?? 0);
    const gst = round2(dto.gst ?? 0);
    const incomeTax = round2(dto.incomeTax ?? 0);
    const total = round2(principal + salesTax + srbSst + gst + incomeTax);
    // Recoverable / input taxes only — incomeTax is vendor WHT (tax payable)
    const inputTax = round2(salesTax + srbSst + gst);
    return {
      principal,
      salesTax,
      srbSst,
      gst,
      incomeTax,
      total,
      inputTax,
      whtPayable: incomeTax,
    };
  }

  private normalizePaymentMode(raw: string) {
    const map: Record<string, string> = {
      cash: 'Cash',
      bank: 'Bank',
      'bank transfer': 'Bank',
      cheque: 'Cheque',
      online: 'Online',
      'credit card': 'Online',
    };
    const key = raw.trim().toLowerCase();
    return map[key] ?? raw.trim();
  }

  private async nextExpenseNo(branchId: string, tx: Prisma.TransactionClient) {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
    const year = new Date().getFullYear();
    const prefix = `EXP-${branch.code}-${year}-`;
    const latest = await tx.expense.findFirst({
      where: { expenseNo: { startsWith: prefix } },
      orderBy: { expenseNo: 'desc' },
      select: { expenseNo: true },
    });
    let next = 1;
    if (latest?.expenseNo) {
      const n = parseInt(latest.expenseNo.slice(prefix.length), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  list(scope: RequestBranchScope) {
    return this.prisma.expense.findMany({
      where: scope.allBranches ? {} : { branchId: scope.branchId! },
      include,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.expense.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Expense not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  async create(
    dto: CreateExpenseDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const expenseDate = this.parseDate(dto.expenseDate);
    await this.fiscal.assertNotLocked(expenseDate);

    const paymentMode = this.normalizePaymentMode(dto.paymentMode);
    const mode = await this.prisma.paymentMode.findUnique({
      where: { code: paymentMode },
    });
    if (!mode) {
      throw new BadRequestException(
        `Invalid payment mode ${dto.paymentMode} (use Cash, Bank, Cheque, Online)`,
      );
    }

    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.categoryId, isActive: true },
    });
    if (!category) throw new BadRequestException('Invalid category');

    let vendorName = dto.vendorName?.trim() || null;
    if (dto.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, deletedAt: null },
      });
      if (!vendor) throw new BadRequestException('Invalid vendor');
      vendorName = vendor.name;
    }
    if (!vendorName) {
      throw new BadRequestException('Vendor name or vendorId is required');
    }

    if (paymentMode === 'Cheque' && !dto.chequeNo?.trim()) {
      throw new BadRequestException('Cheque number is required for cheque payments');
    }

    let bankAccountId = dto.bankAccountId ?? null;
    if (paymentMode === 'Bank' || paymentMode === 'Cheque' || paymentMode === 'Online') {
      if (!bankAccountId) {
        const fallback = await this.prisma.bankAccount.findFirst({
          where: {
            branchId,
            currencyCode: 'PKR',
            deletedAt: null,
            isActive: true,
          },
        });
        bankAccountId = fallback?.id ?? null;
      }
      if (bankAccountId) {
        const bank = await this.prisma.bankAccount.findFirst({
          where: { id: bankAccountId, deletedAt: null, isActive: true },
        });
        if (!bank) throw new BadRequestException('Invalid bank account');
      }
    }

    const amounts = this.totals(dto);
    if (amounts.total <= 0) {
      throw new BadRequestException('Total must be greater than zero');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const expenseNo = await this.nextExpenseNo(branchId, tx);
      return tx.expense.create({
        data: {
          expenseNo,
          branchId,
          vendorId: dto.vendorId ?? null,
          vendorName,
          categoryId: dto.categoryId,
          expenseDate,
          principal: amounts.principal,
          salesTax: amounts.salesTax,
          srbSst: amounts.srbSst,
          gst: amounts.gst,
          incomeTax: amounts.incomeTax,
          total: amounts.total,
          paymentModeCode: paymentMode,
          bankAccountId,
          approvalStatus: ApprovalStatus.Pending,
          requestedById: user.id,
        },
        include,
      });
    });

    // Create cheque shell if needed (linked on approve if still needed)
    if (paymentMode === 'Cheque' && dto.chequeNo?.trim() && bankAccountId) {
      const existing = await this.prisma.cheque.findUnique({
        where: {
          bankAccountId_chequeNo: {
            bankAccountId,
            chequeNo: dto.chequeNo.trim(),
          },
        },
      });
      if (!existing) {
        const cheque = await this.prisma.cheque.create({
          data: {
            chequeNo: dto.chequeNo.trim(),
            bankAccountId,
            payee: vendorName,
            amount: amounts.total,
            issueDate: expenseDate,
            status: 'Issued',
          },
        });
        await this.prisma.expense.update({
          where: { id: row.id },
          data: { chequeId: cheque.id },
        });
      } else {
        await this.prisma.expense.update({
          where: { id: row.id },
          data: { chequeId: existing.id },
        });
      }
    }

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Expenses & Petty Cash',
      entityType: 'Expense',
      entityId: row.id,
      afterData: { total: amounts.total, vendorName },
    });

    await this.approvalsSync.upsertPending({
      approvalType: ApprovalType.Expense,
      title: `${vendorName} — ${row.category.name}`,
      amount: amounts.total,
      branchId,
      requestedById: user.id,
      requestDate: expenseDate,
      sourceType: 'Expense',
      sourceId: row.id,
    });

    return this.get(row.id, scope);
  }

  async update(
    id: string,
    dto: UpdateExpenseDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    if (before.approvalStatus === ApprovalStatus.Approved) {
      throw new ConflictException('Approved expenses cannot be edited');
    }

    const expenseDate = dto.expenseDate
      ? this.parseDate(dto.expenseDate)
      : before.expenseDate;
    await this.fiscal.assertNotLocked(expenseDate);

    let paymentMode = before.paymentModeCode;
    if (dto.paymentMode) {
      paymentMode = this.normalizePaymentMode(dto.paymentMode);
      const mode = await this.prisma.paymentMode.findUnique({
        where: { code: paymentMode },
      });
      if (!mode) throw new BadRequestException('Invalid payment mode');
    }

    if (dto.categoryId) {
      const cat = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, isActive: true },
      });
      if (!cat) throw new BadRequestException('Invalid category');
    }

    let vendorName = dto.vendorName ?? before.vendorName;
    let vendorId = dto.vendorId !== undefined ? dto.vendorId : before.vendorId;
    if (dto.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, deletedAt: null },
      });
      if (!vendor) throw new BadRequestException('Invalid vendor');
      vendorName = vendor.name;
      vendorId = vendor.id;
    }

    const amounts = this.totals({
      principal: dto.principal ?? Number(before.principal),
      salesTax: dto.salesTax ?? Number(before.salesTax),
      srbSst: dto.srbSst ?? Number(before.srbSst),
      gst: dto.gst ?? Number(before.gst),
      incomeTax: dto.incomeTax ?? Number(before.incomeTax),
    });

    const row = await this.prisma.expense.update({
      where: { id },
      data: {
        expenseDate,
        vendorId,
        vendorName,
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        principal: amounts.principal,
        salesTax: amounts.salesTax,
        srbSst: amounts.srbSst,
        gst: amounts.gst,
        incomeTax: amounts.incomeTax,
        total: amounts.total,
        paymentModeCode: paymentMode,
        ...(dto.bankAccountId !== undefined
          ? { bankAccountId: dto.bankAccountId }
          : {}),
      },
      include,
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Expenses & Petty Cash',
      entityType: 'Expense',
      entityId: id,
    });

    return row;
  }

  async approve(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.approvalStatus === ApprovalStatus.Approved) {
      return before;
    }
    if (before.approvalStatus === ApprovalStatus.Rejected) {
      throw new ConflictException('Rejected expenses cannot be approved');
    }
    if (before.requestedById && before.requestedById === user.id) {
      throw new ForbiddenException(
        'Segregation of duties: you cannot approve your own request',
      );
    }
    await this.fiscal.assertNotLocked(before.expenseDate);

    const payFromCash = before.paymentModeCode === 'Cash';
    const whtPayable = round2(Number(before.incomeTax));
    const total = Number(before.total);
    const inputTax = round2(
      Number(before.salesTax) + Number(before.srbSst) + Number(before.gst),
    );
    const cashOut = round2(Number(before.principal) + inputTax - whtPayable);

    await this.prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id },
        data: {
          approvalStatus: ApprovalStatus.Approved,
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });

      await this.gl.postExpense(tx, {
        expenseId: id,
        branchId: before.branchId,
        entryDate: before.expenseDate,
        principal: Number(before.principal),
        inputTax,
        whtPayable,
        total,
        payFromCash,
        vendorLabel: before.vendorName || before.vendor?.name || 'Vendor',
        categoryLabel: before.category.name,
        actorId: user.id,
      });

      // Mirror bank withdrawal when paid from bank (net of WHT withheld)
      if (!payFromCash && before.bankAccountId) {
        await tx.bankTransaction.create({
          data: {
            bankAccountId: before.bankAccountId,
            txnDate: before.expenseDate,
            txnType: 'withdrawal',
            description: `Expense — ${before.vendorName || before.vendor?.name}`,
            amount: cashOut,
            currencyCode: 'PKR',
            reconciliationStatus: 'Unmatched',
            sourceType: 'Expense',
            sourceId: id,
          },
        });
      }
    });

    await this.audit.log({
      userId: user.id,
      action: 'APPROVE',
      module: 'Expenses & Petty Cash',
      entityType: 'Expense',
      entityId: id,
    });

    await this.approvalsSync.markDecided(
      'Expense',
      id,
      ApprovalStatus.Approved,
      user.id,
    );

    return this.get(id, scope);
  }

  async reject(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.approvalStatus === ApprovalStatus.Approved) {
      throw new ConflictException('Approved expenses cannot be rejected');
    }
    const row = await this.prisma.expense.update({
      where: { id },
      data: {
        approvalStatus: ApprovalStatus.Rejected,
        approvedById: user.id,
        approvedAt: new Date(),
      },
      include,
    });
    await this.audit.log({
      userId: user.id,
      action: 'REJECT',
      module: 'Expenses & Petty Cash',
      entityType: 'Expense',
      entityId: id,
    });
    await this.approvalsSync.markDecided(
      'Expense',
      id,
      ApprovalStatus.Rejected,
      user.id,
    );
    return row;
  }

  async remove(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.approvalStatus === ApprovalStatus.Approved) {
      throw new ConflictException('Cannot delete an approved expense');
    }
    await this.prisma.expense.delete({ where: { id } });
    await this.approvalsSync.removeForSource('Expense', id);
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Expenses & Petty Cash',
      entityType: 'Expense',
      entityId: id,
    });
    return { success: true };
  }
}
