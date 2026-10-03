import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalSourceType, Prisma, SubAgentCommissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { CreateCommissionDto, UpdateCommissionDto } from './dto/payables.dto';
import { nextBranchYearNo } from '../common/document-numbers';

const include = {
  subAgent: { select: { id: true, name: true } },
  student: { select: { id: true, studentCode: true, fullName: true } },
  invoice: { select: { id: true, invoiceNo: true, status: true } },
  branch: { select: { id: true, code: true, name: true } },
  payments: { select: { id: true, amountPkr: true, paymentDate: true, chequeNo: true } },
} satisfies Prisma.SubAgentCommissionInclude;

@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gl: GlPostingService,
  ) {}

  private assertBranch(scope: RequestBranchScope, branchId: string) {
    if (!scope.allBranches && scope.branchId !== branchId) {
      throw new ForbiddenException('Cross-branch access is not allowed');
    }
  }

  async computePayableAmounts(input: {
    grossFee: number;
    rateGiven: number;
    exchangeRate: number;
    followOnBonus: number;
  }) {
    const payablePkrGross = round2(
      input.grossFee * (input.rateGiven / 100) * input.exchangeRate +
        input.followOnBonus,
    );
    const whtRate = await this.gl.getWhtRateFraction();
    const whtPkr = round2(payablePkrGross * whtRate);
    const payablePkrNet = round2(payablePkrGross - whtPkr);
    return { payablePkrGross, whtPkr, payablePkrNet };
  }

  list(scope: RequestBranchScope, subAgentId?: string) {
    return this.prisma.subAgentCommission.findMany({
      where: {
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
        ...(subAgentId ? { subAgentId } : {}),
      },
      include,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.subAgentCommission.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Commission not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  async create(
    dto: CreateCommissionDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);

    const [subAgent, student, invoice] = await Promise.all([
      this.prisma.subAgent.findFirst({
        where: { id: dto.subAgentId, deletedAt: null },
      }),
      this.prisma.student.findFirst({
        where: { id: dto.studentId, deletedAt: null },
      }),
      this.prisma.invoice.findFirst({
        where: { id: dto.invoiceId, deletedAt: null },
      }),
    ]);
    if (!subAgent) throw new BadRequestException('Invalid sub-agent');
    if (!student) throw new BadRequestException('Invalid student');
    if (!invoice) throw new BadRequestException('Invalid invoice');
    if (student.branchId !== branchId) {
      throw new BadRequestException('Student branch mismatch');
    }
    if (invoice.branchId !== branchId) {
      throw new BadRequestException('Invoice branch mismatch');
    }

    const amounts = await this.computePayableAmounts({
      grossFee: dto.grossFee,
      rateGiven: dto.rateGiven,
      exchangeRate: dto.exchangeRate,
      followOnBonus: dto.followOnBonus ?? 0,
    });

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const commissionNo = await nextBranchYearNo(tx, branchId, {
          model: 'subAgentCommission',
          field: 'commissionNo',
          docPrefix: 'COM',
        });
        const created = await tx.subAgentCommission.create({
          data: {
            commissionNo,
            subAgentId: dto.subAgentId,
            studentId: dto.studentId,
            invoiceId: dto.invoiceId,
            branchId,
            grossFee: dto.grossFee,
            rateGiven: dto.rateGiven,
            exchangeRate: dto.exchangeRate,
            followOnBonus: dto.followOnBonus ?? 0,
            currencyCode: dto.currencyCode.toUpperCase(),
            payablePkrGross: amounts.payablePkrGross,
            whtPkr: amounts.whtPkr,
            payablePkrNet: amounts.payablePkrNet,
            status: dto.status ?? SubAgentCommissionStatus.Pending,
          },
          include,
        });
        await this.gl.postCommissionAccrual(tx, {
          commissionId: created.id,
          branchId,
          entryDate: created.createdAt,
          payablePkrGross: amounts.payablePkrGross,
          whtPkr: amounts.whtPkr,
          payablePkrNet: amounts.payablePkrNet,
          subAgentName: subAgent.name,
          actorId: user.id,
        });
        return created;
      });

      await this.audit.log({
        userId: user.id,
        action: 'CREATE',
        module: 'Sub-Agents',
        entityType: 'SubAgentCommission',
        entityId: row.id,
        afterData: {
          payablePkrNet: amounts.payablePkrNet,
          subAgentId: dto.subAgentId,
        },
      });
      return row;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Commission already exists for this student + invoice + sub-agent',
        );
      }
      throw e;
    }
  }

  async update(
    id: string,
    dto: UpdateCommissionDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    if (before.payments.length > 0 && (dto.grossFee !== undefined || dto.rateGiven !== undefined || dto.exchangeRate !== undefined || dto.followOnBonus !== undefined)) {
      throw new ConflictException(
        'Cannot change payable amounts after payments exist',
      );
    }

    const grossFee = dto.grossFee ?? Number(before.grossFee);
    const rateGiven = dto.rateGiven ?? Number(before.rateGiven);
    const exchangeRate = dto.exchangeRate ?? Number(before.exchangeRate);
    const followOnBonus =
      dto.followOnBonus ?? Number(before.followOnBonus);
    const amounts = await this.computePayableAmounts({
      grossFee,
      rateGiven,
      exchangeRate,
      followOnBonus,
    });

    const amountsChanged =
      Math.abs(amounts.payablePkrGross - Number(before.payablePkrGross)) > 0.001 ||
      Math.abs(amounts.whtPkr - Number(before.whtPkr)) > 0.001 ||
      Math.abs(amounts.payablePkrNet - Number(before.payablePkrNet)) > 0.001;

    const row = await this.prisma.$transaction(async (tx) => {
      if (amountsChanged) {
        await this.gl.reverseSourceJournal(tx, {
          sourceType: JournalSourceType.SubAgentCommission,
          sourceId: id,
          reverseDate: new Date(),
          reason: `Reversal on commission amount change ${before.commissionNo}`,
          actorId: user.id,
        });
      }

      const updated = await tx.subAgentCommission.update({
        where: { id },
        data: {
          grossFee,
          rateGiven,
          exchangeRate,
          followOnBonus,
          ...(dto.currencyCode
            ? { currencyCode: dto.currencyCode.toUpperCase() }
            : {}),
          payablePkrGross: amounts.payablePkrGross,
          whtPkr: amounts.whtPkr,
          payablePkrNet: amounts.payablePkrNet,
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
        include,
      });

      if (amountsChanged) {
        await this.gl.postCommissionAccrual(tx, {
          commissionId: id,
          branchId: before.branchId,
          entryDate: new Date(),
          payablePkrGross: amounts.payablePkrGross,
          whtPkr: amounts.whtPkr,
          payablePkrNet: amounts.payablePkrNet,
          subAgentName: before.subAgent.name,
          actorId: user.id,
        });
      }

      return updated;
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Sub-Agents',
      entityType: 'SubAgentCommission',
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: row.status, payablePkrNet: amounts.payablePkrNet },
    });

    return this.syncStatus(id, scope);
  }

  async remove(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.payments.length > 0) {
      throw new ConflictException('Cannot delete commission with payments');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.gl.reverseSourceJournal(tx, {
        sourceType: JournalSourceType.SubAgentCommission,
        sourceId: id,
        reverseDate: new Date(),
        reason: `Reversal on delete of commission ${before.commissionNo}`,
        actorId: user.id,
      });
      await tx.subAgentCommission.delete({ where: { id } });
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Sub-Agents',
      entityType: 'SubAgentCommission',
      entityId: id,
    });
    return { success: true };
  }

  async syncStatus(id: string, scope: RequestBranchScope) {
    const row = await this.get(id, scope);
    const paid = round2(
      row.payments.reduce((s, p) => s + Number(p.amountPkr), 0),
    );
    const net = Number(row.payablePkrNet);
    let next: SubAgentCommissionStatus = SubAgentCommissionStatus.Pending;
    if (paid <= 0.001) next = SubAgentCommissionStatus.Pending;
    else if (paid + 0.001 >= net) next = SubAgentCommissionStatus.Paid;
    else next = SubAgentCommissionStatus.Partial;

    if (next === row.status) return row;
    return this.prisma.subAgentCommission.update({
      where: { id },
      data: { status: next },
      include,
    });
  }

  /** Ledger lines for one sub-agent: commissions (debit) + payments (credit). */
  async ledger(subAgentId: string, scope: RequestBranchScope) {
    const commissions = await this.list(scope, subAgentId);
    const entries: Array<{
      date: string;
      type: 'commission' | 'payment';
      ref: string;
      debit: number;
      credit: number;
      commissionId?: string;
      paymentId?: string;
    }> = [];

    for (const c of commissions) {
      entries.push({
        date: c.createdAt.toISOString().slice(0, 10),
        type: 'commission',
        ref: c.invoice.invoiceNo,
        debit: Number(c.payablePkrNet),
        credit: 0,
        commissionId: c.id,
      });
      for (const p of c.payments) {
        entries.push({
          date: p.paymentDate.toISOString().slice(0, 10),
          type: 'payment',
          ref: p.chequeNo || p.id.slice(0, 8),
          debit: 0,
          credit: Number(p.amountPkr),
          commissionId: c.id,
          paymentId: p.id,
        });
      }
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    const withBalance = entries.map((e) => {
      balance = round2(balance + e.debit - e.credit);
      return { ...e, balance };
    });

    const totalPayable = round2(
      commissions.reduce((s, c) => s + Number(c.payablePkrNet), 0),
    );
    const totalPaid = round2(
      commissions.reduce(
        (s, c) =>
          s + c.payments.reduce((ps, p) => ps + Number(p.amountPkr), 0),
        0,
      ),
    );

    return {
      subAgentId,
      totalPayable,
      totalPaid,
      outstanding: round2(totalPayable - totalPaid),
      entries: withBalance,
    };
  }
}
