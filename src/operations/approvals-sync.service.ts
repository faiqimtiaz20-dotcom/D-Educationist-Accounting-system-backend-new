import { Injectable } from '@nestjs/common';
import { ApprovalStatus, ApprovalType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../accounting/gl-posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { currentTenantId } from '../common/tenant-scope';
import { nextYearNo } from '../common/document-numbers';

/** Creates/updates rows in `approvals` so the queue stays in sync with source docs. */
@Injectable()
export class ApprovalsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async upsertPending(input: {
    approvalType: ApprovalType;
    title: string;
    amount: number;
    branchId: string;
    requestedById: string;
    requestDate?: Date;
    sourceType: string;
    sourceId: string;
  }) {
    const approvalNo = await nextYearNo(this.prisma, {
      model: 'approval',
      field: 'approvalNo',
      docPrefix: 'APR',
    });
    const row = await this.prisma.approval.upsert({
      where: {
        sourceType_sourceId: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      create: {
        approvalNo,
        approvalType: input.approvalType,
        title: input.title.slice(0, 200),
        amount: round2(input.amount),
        branchId: input.branchId,
        requestedById: input.requestedById,
        requestDate: input.requestDate ?? new Date(),
        status: ApprovalStatus.Pending,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
      update: {
        title: input.title.slice(0, 200),
        amount: round2(input.amount),
        status: ApprovalStatus.Pending,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
      },
    });

    try {
      const tenantId = row.tenantId || currentTenantId();
      await this.notifications.notifyApprovers({
        tenantId,
        branchId: input.branchId,
        excludeUserId: input.requestedById,
        type: 'APPROVAL_PENDING',
        title: `Approval needed: ${input.title.slice(0, 120)}`,
        body: `${input.approvalType} · ${round2(input.amount).toLocaleString()}`,
        link: '/approvals',
        entityType: 'Approval',
        entityId: row.id,
      });
    } catch {
      /* non-blocking */
    }

    return row;
  }

  async markDecided(
    sourceType: string,
    sourceId: string,
    status: ApprovalStatus,
    decidedById: string,
    note?: string,
  ) {
    const existing = await this.prisma.approval.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId } },
    });
    if (!existing) return null;
    return this.prisma.approval.update({
      where: { id: existing.id },
      data: {
        status,
        decidedById,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
  }

  async removeForSource(sourceType: string, sourceId: string) {
    try {
      await this.prisma.approval.delete({
        where: { sourceType_sourceId: { sourceType, sourceId } },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        return;
      }
      throw e;
    }
  }
}
