import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, ApprovalType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { round2 } from '../accounting/gl-posting.service';
import { ApprovalsSyncService } from '../operations/approvals-sync.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { CreateReimbursementDto } from './dto/payroll.dto';
import { nextYearNo } from '../common/document-numbers';

const include = {
  employee: { select: { id: true, fullName: true } },
  branch: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ReimbursementInclude;

@Injectable()
export class ReimbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  list(scope: RequestBranchScope, status?: ApprovalStatus) {
    return this.prisma.reimbursement.findMany({
      where: {
        ...(scope.allBranches ? {} : { branchId: scope.branchId ?? undefined }),
        ...(status ? { status } : {}),
      },
      include,
      orderBy: { reimbursementDate: 'desc' },
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.reimbursement.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Reimbursement not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  async create(
    dto: CreateReimbursementDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    this.assertBranch(scope, dto.branchId);
    const emp = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    this.assertBranch(scope, emp.branchId);

    const row = await this.prisma.$transaction(async (tx) => {
      const reimbursementNo = await nextYearNo(tx, {
        model: 'reimbursement',
        field: 'reimbursementNo',
        docPrefix: 'REIM',
      });
      return tx.reimbursement.create({
        data: {
          reimbursementNo,
          employeeId: dto.employeeId,
          branchId: dto.branchId,
          reimbursementType: dto.reimbursementType,
          amount: round2(dto.amount),
          reimbursementDate: this.parseDate(dto.reimbursementDate),
          description: dto.description?.trim() || null,
          status: ApprovalStatus.Pending,
          requestedById: user.id,
        },
        include,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Payroll',
      entityType: 'Reimbursement',
      entityId: row.id,
      afterData: { amount: Number(row.amount), type: row.reimbursementType },
    });

    await this.approvalsSync.upsertPending({
      approvalType: ApprovalType.Reimbursement,
      title: `${row.employee.fullName} — ${row.reimbursementType} claim`,
      amount: Number(row.amount),
      branchId: dto.branchId,
      requestedById: user.id,
      requestDate: this.parseDate(dto.reimbursementDate),
      sourceType: 'Reimbursement',
      sourceId: row.id,
    });

    return row;
  }

  async setStatus(
    id: string,
    status: ApprovalStatus,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const existing = await this.get(id, scope);
    if (existing.status !== ApprovalStatus.Pending) {
      throw new BadRequestException('Only pending reimbursements can change status');
    }
    if (
      status !== ApprovalStatus.Approved &&
      status !== ApprovalStatus.Rejected
    ) {
      throw new BadRequestException('Status must be Approved or Rejected');
    }

    const row = await this.prisma.reimbursement.update({
      where: { id },
      data: { status },
      include,
    });

    await this.audit.log({
      userId: user.id,
      action: status === ApprovalStatus.Approved ? 'APPROVE' : 'REJECT',
      module: 'Payroll',
      entityType: 'Reimbursement',
      entityId: id,
    });

    await this.approvalsSync.markDecided(
      'Reimbursement',
      id,
      status,
      user.id,
    );

    return row;
  }
}
