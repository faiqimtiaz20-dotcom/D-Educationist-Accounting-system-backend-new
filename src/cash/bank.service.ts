import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import {
  CreateBankTxnDto,
  CreateChequeDto,
  UpdateBankTxnDto,
  UpdateChequeStatusDto,
} from './dto/cash.dto';

@Injectable()
export class BankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalLockService,
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

  async listAccounts(scope: RequestBranchScope) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: {
        deletedAt: null,
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
      },
      orderBy: [{ name: 'asc' }],
    });

    const withBalance = await Promise.all(
      accounts.map(async (a) => {
        const aggs = await this.prisma.bankTransaction.groupBy({
          by: ['txnType'],
          where: { bankAccountId: a.id },
          _sum: { amount: true },
        });
        let movement = 0;
        for (const g of aggs) {
          const sum = Number(g._sum.amount ?? 0);
          if (g.txnType === 'deposit') movement += sum;
          else movement -= sum; // withdrawal + transfer out
        }
        return {
          ...a,
          balance: round2(Number(a.openingBalance) + movement),
        };
      }),
    );

    return withBalance;
  }

  listTransactions(scope: RequestBranchScope, bankAccountId?: string) {
    return this.prisma.bankTransaction.findMany({
      where: {
        ...(bankAccountId ? { bankAccountId } : {}),
        ...(scope.allBranches
          ? {}
          : { bankAccount: { branchId: scope.branchId! } }),
      },
      include: {
        bankAccount: { select: { id: true, name: true, branchId: true } },
      },
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createTransaction(
    dto: CreateBankTxnDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, deletedAt: null, isActive: true },
    });
    if (!account) throw new BadRequestException('Invalid bank account');
    this.assertBranch(scope, account.branchId);

    const txnDate = this.parseDate(dto.txnDate);
    await this.fiscal.assertNotLocked(txnDate);

    if (dto.txnType === 'transfer' && !dto.counterpartyBankAccountId) {
      throw new BadRequestException(
        'counterpartyBankAccountId required for transfers',
      );
    }

    const amount = round2(dto.amount);
    const row = await this.prisma.bankTransaction.create({
      data: {
        bankAccountId: dto.bankAccountId,
        txnDate,
        txnType: dto.txnType,
        description: dto.description.trim(),
        amount,
        currencyCode: account.currencyCode,
        counterpartyBankAccountId: dto.counterpartyBankAccountId ?? null,
        reconciliationStatus: dto.reconciliationStatus ?? 'Unmatched',
        sourceType: 'Manual',
      },
      include: {
        bankAccount: { select: { id: true, name: true, branchId: true } },
      },
    });

    // Mirror opposite leg for transfer
    if (dto.txnType === 'transfer' && dto.counterpartyBankAccountId) {
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: dto.counterpartyBankAccountId,
          txnDate,
          txnType: 'deposit',
          description: `Transfer in — ${dto.description.trim()}`,
          amount,
          currencyCode: account.currencyCode,
          counterpartyBankAccountId: dto.bankAccountId,
          reconciliationStatus: dto.reconciliationStatus ?? 'Unmatched',
          sourceType: 'Manual',
          sourceId: row.id,
        },
      });
    }

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Bank & Cash',
      entityType: 'BankTransaction',
      entityId: row.id,
      afterData: { amount, txnType: dto.txnType },
    });

    return row;
  }

  async updateTransaction(
    id: string,
    dto: UpdateBankTxnDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const row = await this.prisma.bankTransaction.findUnique({
      where: { id },
      include: { bankAccount: true },
    });
    if (!row) throw new NotFoundException('Bank transaction not found');
    this.assertBranch(scope, row.bankAccount.branchId);

    const updated = await this.prisma.bankTransaction.update({
      where: { id },
      data: {
        ...(dto.reconciliationStatus
          ? { reconciliationStatus: dto.reconciliationStatus }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
      },
      include: {
        bankAccount: { select: { id: true, name: true, branchId: true } },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Bank & Cash',
      entityType: 'BankTransaction',
      entityId: id,
    });

    return updated;
  }

  listCheques(scope: RequestBranchScope) {
    return this.prisma.cheque.findMany({
      where: scope.allBranches
        ? {}
        : { bankAccount: { branchId: scope.branchId! } },
      include: {
        bankAccount: { select: { id: true, name: true, branchId: true } },
      },
      orderBy: [{ issueDate: 'desc' }],
    });
  }

  async createCheque(
    dto: CreateChequeDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, deletedAt: null, isActive: true },
    });
    if (!account) throw new BadRequestException('Invalid bank account');
    this.assertBranch(scope, account.branchId);

    const issueDate = this.parseDate(dto.issueDate);
    await this.fiscal.assertNotLocked(issueDate);

    try {
      const row = await this.prisma.cheque.create({
        data: {
          chequeNo: dto.chequeNo.trim(),
          bankAccountId: dto.bankAccountId,
          payee: dto.payee.trim(),
          amount: round2(dto.amount),
          issueDate,
          status: 'Issued',
        },
        include: {
          bankAccount: { select: { id: true, name: true, branchId: true } },
        },
      });
      await this.audit.log({
        userId: user.id,
        action: 'CREATE',
        module: 'Bank & Cash',
        entityType: 'Cheque',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Cheque number already exists for this bank account',
        );
      }
      throw e;
    }
  }

  async updateChequeStatus(
    id: string,
    dto: UpdateChequeStatusDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const row = await this.prisma.cheque.findUnique({
      where: { id },
      include: { bankAccount: true },
    });
    if (!row) throw new NotFoundException('Cheque not found');
    this.assertBranch(scope, row.bankAccount.branchId);

    if (dto.status === 'Cleared' || dto.status === 'Bounced') {
      if (row.status !== 'Issued') {
        throw new BadRequestException(
          `Cannot change cheque from ${row.status} to ${dto.status}`,
        );
      }
    }

    const clearedDate =
      dto.status === 'Cleared'
        ? this.parseDate(dto.clearedDate || new Date().toISOString())
        : null;

    const updated = await this.prisma.cheque.update({
      where: { id },
      data: {
        status: dto.status,
        clearedDate,
      },
      include: {
        bankAccount: { select: { id: true, name: true, branchId: true } },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Bank & Cash',
      entityType: 'Cheque',
      entityId: id,
      afterData: { status: dto.status },
    });

    return updated;
  }
}
