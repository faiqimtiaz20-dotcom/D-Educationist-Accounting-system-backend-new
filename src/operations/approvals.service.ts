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
import { ExpensesService } from '../cash/expenses.service';
import { JournalsService } from '../accounting/journals.service';
import { ReimbursementsService } from '../payroll/reimbursements.service';
import { ApprovalsSyncService } from './approvals-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';

const TYPE_LABEL: Record<ApprovalType, string> = {
  Expense: 'Expense',
  SubAgentPayout: 'Sub-Agent Payout',
  Journal: 'Journal',
  Refund: 'Refund',
  Reimbursement: 'Reimbursement',
  Payroll: 'Payroll',
};

const include = {
  branch: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, fullName: true, email: true } },
  decidedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ApprovalInclude;

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: ApprovalsSyncService,
    private readonly expenses: ExpensesService,
    private readonly journals: JournalsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertBranch(scope: RequestBranchScope, branchId: string) {
    if (!scope.allBranches && scope.branchId !== branchId) {
      throw new ForbiddenException('Cross-branch access is not allowed');
    }
  }

  private map(
    row: Prisma.ApprovalGetPayload<{ include: typeof include }>,
  ) {
    return {
      id: row.id,
      approvalNo: row.approvalNo,
      type: TYPE_LABEL[row.approvalType],
      approvalType: row.approvalType,
      title: row.title,
      amount: Number(row.amount),
      requestedBy: row.requestedBy.fullName,
      requestedById: row.requestedById,
      date: row.requestDate.toISOString().slice(0, 10),
      status: row.status,
      branchId: row.branchId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      decidedById: row.decidedById,
      decidedByName: row.decidedBy?.fullName ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      branch: row.branch,
    };
  }

  async list(
    scope: RequestBranchScope,
    opts: { status?: ApprovalStatus; approvalType?: ApprovalType } = {},
  ) {
    const rows = await this.prisma.approval.findMany({
      where: {
        ...(scope.allBranches
          ? {}
          : { branchId: scope.branchId ?? undefined }),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.approvalType ? { approvalType: opts.approvalType } : {}),
      },
      include,
      orderBy: [{ status: 'asc' }, { requestDate: 'desc' }],
    });
    return rows.map((r) => this.map(r));
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.approval.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Approval not found');
    this.assertBranch(scope, row.branchId);
    return this.map(row);
  }

  async decide(
    id: string,
    status: 'Approved' | 'Rejected',
    user: AuthUserPayload,
    scope: RequestBranchScope,
    note?: string,
  ) {
    const row = await this.prisma.approval.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Approval not found');
    this.assertBranch(scope, row.branchId);

    if (row.status !== ApprovalStatus.Pending) {
      throw new ConflictException('Approval already decided');
    }
    if (row.requestedById === user.id) {
      throw new ForbiddenException(
        'Segregation of duties: you cannot approve your own request',
      );
    }

    // Apply to source document first (GL side effects where applicable)
    switch (row.approvalType) {
      case ApprovalType.Expense:
        if (status === ApprovalStatus.Approved) {
          await this.expenses.approve(row.sourceId, user, scope);
        } else {
          await this.expenses.reject(row.sourceId, user, scope);
        }
        break;
      case ApprovalType.Reimbursement:
        await this.reimbursements.setStatus(
          row.sourceId,
          status,
          user,
          scope,
        );
        break;
      case ApprovalType.Journal:
        if (status === ApprovalStatus.Approved) {
          await this.journals.approve(row.sourceId, user, scope);
        } else {
          await this.journals.reject(row.sourceId, user, scope);
        }
        break;
      case ApprovalType.SubAgentPayout:
      case ApprovalType.Refund:
      case ApprovalType.Payroll:
        // Source modules already handle their own state; queue decision only
        break;
      default:
        throw new BadRequestException('Unsupported approval type');
    }

    const updated = await this.sync.markDecided(
      row.sourceType,
      row.sourceId,
      status,
      user.id,
      note,
    );
    if (!updated) {
      // Source approve may have already marked it; re-read
      return this.get(id, scope);
    }

    await this.audit.log({
      userId: user.id,
      action: status === ApprovalStatus.Approved ? 'APPROVE' : 'REJECT',
      module: 'Approvals',
      entityType: 'Approval',
      entityId: id,
      afterData: {
        approvalType: row.approvalType,
        sourceId: row.sourceId,
        status,
        note: note ?? null,
      },
    });

    if (row.requestedById !== user.id) {
      try {
        await this.notifications.create({
          tenantId: row.tenantId,
          userId: row.requestedById,
          type: 'APPROVAL_DECIDED',
          title: `${TYPE_LABEL[row.approvalType]} ${status.toLowerCase()}`,
          body: row.title,
          link: '/approvals',
          entityType: 'Approval',
          entityId: id,
        });
      } catch {
        /* non-blocking */
      }
    }

    return this.get(id, scope);
  }
}
