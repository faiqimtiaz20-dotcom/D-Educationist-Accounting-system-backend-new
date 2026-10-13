import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import { runGlTransaction } from '../common/gl-transaction';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { CreatePettyCashDto, UpdatePettyCashDto } from './dto/cash.dto';
import { nextBranchYearNo } from '../common/document-numbers';

const include = {
  category: { select: { id: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  bankAccount: { select: { id: true, name: true, bankName: true, accountNo: true } },
} satisfies Prisma.PettyCashEntryInclude;

@Injectable()
export class PettyCashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalLockService,
    private readonly gl: GlPostingService,
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

  /** Running petty-cash float for a branch: sum(in) − sum(out). */
  private async branchBalance(branchId: string): Promise<number> {
    const rows = await this.prisma.pettyCashEntry.findMany({
      where: { branchId },
      select: { entryType: true, total: true },
    });
    let balance = 0;
    for (const row of rows) {
      const amt = Number(row.total);
      balance += row.entryType === 'in' ? amt : -amt;
    }
    return round2(balance);
  }

  /** Sub-ledger balance for one bank account. */
  private async bankAccountBalance(bankAccountId: string): Promise<number> {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, deletedAt: null },
    });
    if (!account) throw new BadRequestException('Invalid bank account');
    const aggs = await this.prisma.bankTransaction.groupBy({
      by: ['txnType'],
      where: { bankAccountId },
      _sum: { amount: true },
    });
    let movement = 0;
    for (const g of aggs) {
      const sum = Number(g._sum.amount ?? 0);
      if (g.txnType === 'deposit') movement += sum;
      else movement -= sum;
    }
    return round2(Number(account.openingBalance) + movement);
  }

  list(scope: RequestBranchScope) {
    return this.prisma.pettyCashEntry.findMany({
      where: scope.allBranches ? {} : { branchId: scope.branchId! },
      include,
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.pettyCashEntry.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Petty cash entry not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  async create(
    dto: CreatePettyCashDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const entryDate = this.parseDate(dto.entryDate);
    await this.fiscal.assertNotLocked(entryDate);

    const category = await this.prisma.pettyCashCategory.findFirst({
      where: { id: dto.categoryId, isActive: true },
    });
    if (!category) throw new BadRequestException('Invalid category');

    const amounts = this.totals(dto);
    if (amounts.total <= 0) {
      throw new BadRequestException('Total must be greater than zero');
    }

    let bankAccountId: string | null = null;
    if (dto.entryType === 'in') {
      if (!dto.bankAccountId) {
        throw new BadRequestException(
          'bankAccountId is required for Cash In (top-up from bank)',
        );
      }
      const bank = await this.prisma.bankAccount.findFirst({
        where: {
          id: dto.bankAccountId,
          deletedAt: null,
          isActive: true,
        },
      });
      if (!bank) throw new BadRequestException('Invalid bank account');
      if (bank.branchId !== branchId) {
        throw new BadRequestException(
          'Bank account must belong to the same branch as the petty cash entry',
        );
      }
      this.assertBranch(scope, bank.branchId);
      const bankBal = await this.bankAccountBalance(bank.id);
      if (amounts.total > bankBal + 1e-9) {
        throw new BadRequestException(
          `Top-up ${amounts.total} exceeds bank balance ${bankBal} on ${bank.name}`,
        );
      }
      bankAccountId = bank.id;
    } else if (dto.bankAccountId) {
      throw new BadRequestException(
        'bankAccountId is only allowed on Cash In entries',
      );
    }

    if (dto.entryType === 'out') {
      const balance = await this.branchBalance(branchId);
      if (amounts.total > balance + 1e-9) {
        throw new BadRequestException(
          `Petty cash outflow ${amounts.total} exceeds available balance ${balance}`,
        );
      }
    }

    const row = await runGlTransaction(this.prisma, async (tx) => {
      const pettyCashNo = await nextBranchYearNo(tx, branchId, {
        model: 'pettyCashEntry',
        field: 'pettyCashNo',
        docPrefix: 'PC',
      });
      const entry = await tx.pettyCashEntry.create({
        data: {
          pettyCashNo,
          branchId,
          entryDate,
          categoryId: dto.categoryId,
          description: dto.description.trim(),
          entryType: dto.entryType,
          bankAccountId,
          principal: amounts.principal,
          salesTax: amounts.salesTax,
          srbSst: amounts.srbSst,
          gst: amounts.gst,
          incomeTax: amounts.incomeTax,
          total: amounts.total,
          createdById: user.id,
        },
        include,
      });

      await this.gl.postPettyCash(tx, {
        entryId: entry.id,
        branchId,
        entryDate,
        entryType: dto.entryType,
        principal: amounts.principal,
        inputTax: amounts.inputTax,
        whtPayable: amounts.whtPayable,
        total: amounts.total,
        categoryLabel: category.name,
        actorId: user.id,
      });

      // Sub-ledger: reduce the selected bank so multi-bank balances stay correct.
      if (dto.entryType === 'in' && bankAccountId) {
        await tx.bankTransaction.create({
          data: {
            bankAccountId,
            txnDate: entryDate,
            txnType: 'withdrawal',
            description: `Petty cash top-up ${pettyCashNo}`,
            amount: amounts.total,
            currencyCode: 'PKR',
            reconciliationStatus: 'Unmatched',
            sourceType: 'PettyCash',
            sourceId: entry.id,
          },
        });
      }

      return entry;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Expenses & Petty Cash',
      entityType: 'PettyCashEntry',
      entityId: row.id,
      afterData: { total: amounts.total, entryType: dto.entryType },
    });

    return this.get(row.id, scope);
  }

  async update(
    id: string,
    dto: UpdatePettyCashDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    const je = await this.prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: { sourceType: 'PettyCash', sourceId: id },
      },
    });
    if (je) {
      throw new ConflictException(
        'Cannot edit posted petty cash entry (reversal comes in M8)',
      );
    }

    const entryDate = dto.entryDate
      ? this.parseDate(dto.entryDate)
      : before.entryDate;
    await this.fiscal.assertNotLocked(entryDate);

    if (dto.categoryId) {
      const cat = await this.prisma.pettyCashCategory.findFirst({
        where: { id: dto.categoryId, isActive: true },
      });
      if (!cat) throw new BadRequestException('Invalid category');
    }

    const amounts = this.totals({
      principal: dto.principal ?? Number(before.principal),
      salesTax: dto.salesTax ?? Number(before.salesTax),
      srbSst: dto.srbSst ?? Number(before.srbSst),
      gst: dto.gst ?? Number(before.gst),
      incomeTax: dto.incomeTax ?? Number(before.incomeTax),
    });

    const row = await this.prisma.pettyCashEntry.update({
      where: { id },
      data: {
        entryDate,
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.entryType ? { entryType: dto.entryType } : {}),
        principal: amounts.principal,
        salesTax: amounts.salesTax,
        srbSst: amounts.srbSst,
        gst: amounts.gst,
        incomeTax: amounts.incomeTax,
        total: amounts.total,
      },
      include,
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Expenses & Petty Cash',
      entityType: 'PettyCashEntry',
      entityId: id,
    });

    return row;
  }

  async remove(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    await this.get(id, scope);
    const je = await this.prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: { sourceType: 'PettyCash', sourceId: id },
      },
    });
    if (je) {
      throw new ConflictException(
        'Cannot delete posted petty cash entry (reversal comes in M8)',
      );
    }
    await this.prisma.pettyCashEntry.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Expenses & Petty Cash',
      entityType: 'PettyCashEntry',
      entityId: id,
    });
    return { success: true };
  }
}
