import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { CommissionsService } from './commissions.service';
import { CreatePaymentDto } from './dto/payables.dto';
import { nextYearNo } from '../common/document-numbers';

const include = {
  commission: {
    select: {
      id: true,
      payablePkrNet: true,
      whtPkr: true,
      payablePkrGross: true,
      status: true,
      branchId: true,
    },
  },
  subAgent: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, name: true } },
} satisfies Prisma.SubAgentPaymentInclude;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalLockService,
    private readonly gl: GlPostingService,
    private readonly commissions: CommissionsService,
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

  list(scope: RequestBranchScope, subAgentId?: string) {
    return this.prisma.subAgentPayment.findMany({
      where: {
        ...(subAgentId ? { subAgentId } : {}),
        ...(scope.allBranches
          ? {}
          : { commission: { branchId: scope.branchId! } }),
      },
      include,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.subAgentPayment.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Payment not found');
    this.assertBranch(scope, row.commission.branchId);
    return row;
  }

  async create(
    dto: CreatePaymentDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const commission = await this.commissions.get(dto.commissionId, scope);
    const paymentDate = this.parseDate(dto.paymentDate);
    await this.fiscal.assertNotLocked(paymentDate);

    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, deletedAt: null, isActive: true },
    });
    if (!bank) throw new BadRequestException('Invalid bank account');

    const paid = round2(
      commission.payments.reduce((s, p) => s + Number(p.amountPkr), 0),
    );
    const outstanding = round2(Number(commission.payablePkrNet) - paid);
    if (dto.amountPkr > outstanding + 0.001) {
      throw new BadRequestException(
        `Amount exceeds outstanding ${outstanding}`,
      );
    }

    const net = Number(commission.payablePkrNet);
    const whtTotal = Number(commission.whtPkr);
    const whtShare =
      net > 0 ? round2((dto.amountPkr / net) * whtTotal) : 0;

    const row = await this.prisma.$transaction(async (tx) => {
      const paymentNo = await nextYearNo(tx, {
        model: 'subAgentPayment',
        field: 'paymentNo',
        docPrefix: 'PV',
      });
      const payment = await tx.subAgentPayment.create({
        data: {
          paymentNo,
          commissionId: dto.commissionId,
          subAgentId: commission.subAgentId,
          bankAccountId: dto.bankAccountId,
          chequeNo: dto.chequeNo?.trim() || null,
          amountPkr: dto.amountPkr,
          paymentDate,
          currencyCode: (dto.currencyCode || 'PKR').toUpperCase(),
          createdById: user.id,
        },
        include,
      });

      await this.gl.postSubAgentPayment(tx, {
        paymentId: payment.id,
        commissionId: dto.commissionId,
        branchId: commission.branchId,
        entryDate: paymentDate,
        amountPkrNet: dto.amountPkr,
        whtPkrShare: whtShare,
        subAgentName: commission.subAgent.name,
        chequeNo: payment.chequeNo,
        actorId: user.id,
      });

      return payment;
    });

    await this.commissions.syncStatus(dto.commissionId, scope);

    await this.audit.log({
      userId: user.id,
      action: 'PAY',
      module: 'Sub-Agents',
      entityType: 'SubAgentPayment',
      entityId: row.id,
      afterData: { amountPkr: dto.amountPkr, commissionId: dto.commissionId },
    });

    return this.get(row.id, scope);
  }

  async remove(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    await this.fiscal.assertNotLocked(before.paymentDate);

    await this.prisma.$transaction(async (tx) => {
      await this.gl.reverseSourceJournal(tx, {
        sourceType: JournalSourceType.SubAgentPayment,
        sourceId: id,
        reverseDate: before.paymentDate,
        reason: `Reversal on delete of payment ${before.paymentNo ?? id}`,
        actorId: user.id,
      });
      await tx.subAgentPayment.delete({ where: { id } });
    });
    await this.commissions.syncStatus(before.commissionId, scope);
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Sub-Agents',
      entityType: 'SubAgentPayment',
      entityId: id,
    });
    return { success: true };
  }
}
