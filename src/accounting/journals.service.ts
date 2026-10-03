import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, ApprovalType, JournalSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from './fiscal-lock.service';
import { GlPostingService, round2 } from './gl-posting.service';
import { ApprovalsSyncService } from '../operations/approvals-sync.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import {
  CreateJournalDto,
  JournalLineDto,
  ReverseJournalDto,
  UpdateJournalDto,
} from './dto/journals.dto';

const include = {
  branch: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      glAccount: { select: { id: true, code: true, name: true, accountType: true } },
    },
    orderBy: { lineNo: 'asc' as const },
  },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.JournalEntryInclude;

@Injectable()
export class JournalsService {
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

  private assertBalanced(lines: JournalLineDto[]) {
    const debit = round2(lines.reduce((s, l) => s + Number(l.debit), 0));
    const credit = round2(lines.reduce((s, l) => s + Number(l.credit), 0));
    if (debit <= 0 || Math.abs(debit - credit) > 0.01) {
      throw new BadRequestException(
        `Journal must balance (debit ${debit} ≠ credit ${credit})`,
      );
    }
    for (const l of lines) {
      if (Number(l.debit) > 0 && Number(l.credit) > 0) {
        throw new BadRequestException(
          'A line cannot have both debit and credit',
        );
      }
      if (Number(l.debit) <= 0 && Number(l.credit) <= 0) {
        throw new BadRequestException('Each line needs a debit or credit');
      }
    }
  }

  private async resolveLines(lines: JournalLineDto[]) {
    this.assertBalanced(lines);
    const resolved: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
      memo: string | null;
    }> = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const acc = await this.prisma.glAccount.findFirst({
        where: {
          code: l.accountCode,
          isActive: true,
          isPostable: true,
        },
      });
      if (!acc) {
        throw new BadRequestException(
          `Invalid or non-postable account ${l.accountCode}`,
        );
      }
      resolved.push({
        lineNo: i + 1,
        glAccountId: acc.id,
        debit: round2(l.debit),
        credit: round2(l.credit),
        memo: l.memo?.trim() || null,
      });
    }
    return resolved;
  }

  list(
    scope: RequestBranchScope,
    filters?: {
      sourceType?: JournalSourceType;
      approvalStatus?: ApprovalStatus;
      from?: string;
      to?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const where: Prisma.JournalEntryWhereInput = {
      ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
      ...(filters?.sourceType ? { sourceType: filters.sourceType } : {}),
      ...(filters?.approvalStatus
        ? { approvalStatus: filters.approvalStatus }
        : {}),
      ...(filters?.from || filters?.to
        ? {
            entryDate: {
              ...(filters.from
                ? { gte: this.parseDate(filters.from) }
                : {}),
              ...(filters.to ? { lte: this.parseDate(filters.to) } : {}),
            },
          }
        : {}),
    };

    const take =
      filters?.take != null
        ? Math.min(Math.max(Number(filters.take), 1), 500)
        : undefined;
    const skip =
      take != null ? Math.max(Number(filters?.skip ?? 0), 0) : undefined;

    if (take == null) {
      return this.prisma.journalEntry.findMany({
        where,
        include,
        orderBy: [{ entryDate: 'desc' }, { entryNo: 'desc' }],
      });
    }

    return Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include,
        orderBy: [{ entryDate: 'desc' }, { entryNo: 'desc' }],
        take,
        skip,
      }),
      this.prisma.journalEntry.count({ where }),
    ]).then(([items, total]) => ({ items, total, take, skip: skip ?? 0 }));
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.journalEntry.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Journal entry not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  async create(
    dto: CreateJournalDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const entryDate = this.parseDate(dto.entryDate);
    await this.fiscal.assertNotLocked(entryDate);
    const lines = await this.resolveLines(dto.lines);
    const approveNow = Boolean(dto.approveNow);

    const row = await this.prisma.$transaction(async (tx) => {
      const entryNo = await this.gl.allocateEntryNo(tx);
      const entry = await tx.journalEntry.create({
        data: {
          entryNo,
          entryDate,
          branchId,
          description: dto.description.trim(),
          approvalStatus: approveNow
            ? ApprovalStatus.Approved
            : ApprovalStatus.Pending,
          sourceType: JournalSourceType.Manual,
          isAutoPosted: false,
          postedAt: approveNow ? new Date() : null,
          createdById: user.id,
          approvedById: approveNow ? user.id : null,
          lines: { create: lines },
        },
      });
      // Link Manual source to self for uniqueness / reversal tracking
      return tx.journalEntry.update({
        where: { id: entry.id },
        data: { sourceId: entry.id },
        include,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Journal Entries',
      entityType: 'JournalEntry',
      entityId: row.id,
      afterData: { entryNo: row.entryNo, approvalStatus: row.approvalStatus },
    });

    if (row.approvalStatus === ApprovalStatus.Pending) {
      const debit = round2(
        row.lines.reduce((s, l) => s + Number(l.debit), 0),
      );
      await this.approvalsSync.upsertPending({
        approvalType: ApprovalType.Journal,
        title: `${row.entryNo} — ${row.description}`.slice(0, 200),
        amount: debit,
        branchId: row.branchId,
        requestedById: user.id,
        requestDate: row.entryDate,
        sourceType: 'JournalEntry',
        sourceId: row.id,
      });
    }

    return row;
  }

  async update(
    id: string,
    dto: UpdateJournalDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    if (before.isAutoPosted) {
      throw new ConflictException('Auto-posted journals cannot be edited');
    }
    if (before.approvalStatus === ApprovalStatus.Approved) {
      throw new ConflictException(
        'Approved journals cannot be edited — use reverse',
      );
    }
    if (before.sourceType === JournalSourceType.Reversal) {
      throw new ConflictException('Reversal journals cannot be edited');
    }

    const entryDate = dto.entryDate
      ? this.parseDate(dto.entryDate)
      : before.entryDate;
    await this.fiscal.assertNotLocked(entryDate);

    const lines = dto.lines
      ? await this.resolveLines(dto.lines)
      : undefined;

    const row = await this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.journalLine.deleteMany({ where: { journalEntryId: id } });
        await tx.journalLine.createMany({
          data: lines.map((l) => ({ ...l, journalEntryId: id })),
        });
      }
      return tx.journalEntry.update({
        where: { id },
        data: {
          entryDate,
          ...(dto.description !== undefined
            ? { description: dto.description.trim() }
            : {}),
        },
        include,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Journal Entries',
      entityType: 'JournalEntry',
      entityId: id,
    });

    return row;
  }

  async approve(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.approvalStatus === ApprovalStatus.Approved) return before;
    if (before.isAutoPosted) {
      throw new ConflictException('Auto-posted journal is already approved');
    }
    await this.fiscal.assertNotLocked(before.entryDate);

    const row = await this.prisma.journalEntry.update({
      where: { id },
      data: {
        approvalStatus: ApprovalStatus.Approved,
        approvedById: user.id,
        postedAt: new Date(),
      },
      include,
    });

    await this.audit.log({
      userId: user.id,
      action: 'APPROVE',
      module: 'Journal Entries',
      entityType: 'JournalEntry',
      entityId: id,
    });

    await this.approvalsSync.markDecided(
      'JournalEntry',
      id,
      ApprovalStatus.Approved,
      user.id,
    );

    return row;
  }

  async reject(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.approvalStatus === ApprovalStatus.Approved) {
      throw new ConflictException('Approved journals cannot be rejected — reverse instead');
    }
    if (before.isAutoPosted) {
      throw new ConflictException('Auto-posted journals cannot be rejected');
    }
    if (before.approvalStatus === ApprovalStatus.Rejected) return before;

    const row = await this.prisma.journalEntry.update({
      where: { id },
      data: {
        approvalStatus: ApprovalStatus.Rejected,
        approvedById: user.id,
      },
      include,
    });

    await this.audit.log({
      userId: user.id,
      action: 'REJECT',
      module: 'Journal Entries',
      entityType: 'JournalEntry',
      entityId: id,
    });

    await this.approvalsSync.markDecided(
      'JournalEntry',
      id,
      ApprovalStatus.Rejected,
      user.id,
    );

    return row;
  }

  async reverse(
    id: string,
    dto: ReverseJournalDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const original = await this.get(id, scope);
    if (original.approvalStatus !== ApprovalStatus.Approved) {
      throw new ConflictException('Only approved journals can be reversed');
    }
    if (original.sourceType === JournalSourceType.Reversal) {
      throw new ConflictException('Cannot reverse a reversal entry');
    }

    const existing = await this.prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: JournalSourceType.Reversal,
          sourceId: id,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Journal already reversed');
    }

    const reverseDate = dto.reverseDate
      ? this.parseDate(dto.reverseDate)
      : new Date();
    await this.fiscal.assertNotLocked(reverseDate);

    const reason = dto.reason?.trim() || `Reversal of ${original.entryNo}`;

    const row = await this.prisma.$transaction(async (tx) => {
      const entryNo = await this.gl.allocateEntryNo(tx);
      return tx.journalEntry.create({
        data: {
          entryNo,
          entryDate: reverseDate,
          branchId: original.branchId,
          description: reason,
          approvalStatus: ApprovalStatus.Approved,
          sourceType: JournalSourceType.Reversal,
          sourceId: id,
          isAutoPosted: true,
          postedAt: new Date(),
          createdById: user.id,
          approvedById: user.id,
          lines: {
            create: original.lines.map((l, i) => ({
              lineNo: i + 1,
              glAccountId: l.glAccountId,
              debit: l.credit,
              credit: l.debit,
              memo: `Reversal of ${original.entryNo} L${l.lineNo}`,
            })),
          },
        },
        include,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'REVERSE',
      module: 'Journal Entries',
      entityType: 'JournalEntry',
      entityId: row.id,
      afterData: { reverses: id, entryNo: row.entryNo },
    });

    return row;
  }

  async remove(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    if (before.isAutoPosted || before.approvalStatus === ApprovalStatus.Approved) {
      throw new ConflictException(
        'Cannot delete posted journal — use reverse',
      );
    }
    await this.prisma.journalEntry.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Journal Entries',
      entityType: 'JournalEntry',
      entityId: id,
    });
    return { success: true };
  }
}
