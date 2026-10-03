import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalSourceType, OtherInvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import {
  CreateOtherInvoiceDto,
  UpdateOtherInvoiceDto,
} from './dto/revenue.dto';

const include = {
  lines: { orderBy: { lineNo: 'asc' as const } },
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.OtherInvoiceInclude;

@Injectable()
export class OtherInvoicesService {
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
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date ${raw}`);
    return d;
  }

  private total(lines: Array<{ lineTotal: Prisma.Decimal | number }>) {
    return round2(lines.reduce((s, l) => s + Number(l.lineTotal), 0));
  }

  list(scope: RequestBranchScope) {
    return this.prisma.otherInvoice.findMany({
      where: {
        deletedAt: null,
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
      },
      include,
      orderBy: [{ invoiceDate: 'desc' }, { invoiceNo: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.otherInvoice.findFirst({
      where: { id, deletedAt: null },
      include,
    });
    if (!row) throw new NotFoundException('Other invoice not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  private async nextNo(branchId: string, tx: Prisma.TransactionClient) {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
    const year = new Date().getFullYear();
    const prefix = `OINV-${branch.code}-${year}-`;
    const latest = await tx.otherInvoice.findFirst({
      where: { invoiceNo: { startsWith: prefix } },
      orderBy: { invoiceNo: 'desc' },
    });
    let next = 1;
    if (latest?.invoiceNo) {
      const n = parseInt(latest.invoiceNo.slice(prefix.length), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  async create(
    dto: CreateOtherInvoiceDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const invoiceDate = this.parseDate(dto.invoiceDate);
    await this.fiscal.assertNotLocked(invoiceDate);
    const status = dto.status ?? OtherInvoiceStatus.Draft;
    const fx = await this.gl.getFxRateToPkr(dto.currencyCode, invoiceDate);

    const row = await this.prisma.$transaction(async (tx) => {
      const invoiceNo = await this.nextNo(branchId, tx);
      const invoice = await tx.otherInvoice.create({
        data: {
          invoiceNo,
          branchId,
          invoiceDate,
          billTo: dto.billTo.trim(),
          category: dto.category.trim(),
          currencyCode: dto.currencyCode.toUpperCase(),
          status,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
          lines: {
            create: dto.lines.map((l, i) => ({
              lineNo: i + 1,
              description: l.description.trim(),
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: round2(l.quantity * l.unitPrice),
            })),
          },
        },
        include,
      });

      if (status !== OtherInvoiceStatus.Draft) {
        await this.gl.postOtherInvoiceAccrual(tx, {
          otherInvoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          branchId,
          entryDate: invoiceDate,
          amountPkr: round2(this.total(invoice.lines) * fx),
          actorId: user.id,
        });
      }
      return invoice;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Other Invoices',
      entityType: 'OtherInvoice',
      entityId: row.id,
      afterData: { invoiceNo: row.invoiceNo, status: row.status },
    });
    return this.get(row.id, scope);
  }

  async update(
    id: string,
    dto: UpdateOtherInvoiceDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    const invoiceDate = dto.invoiceDate
      ? this.parseDate(dto.invoiceDate)
      : before.invoiceDate;
    await this.fiscal.assertNotLocked(invoiceDate);

    const nextStatus = dto.status ?? before.status;
    const leavingDraft =
      before.status === OtherInvoiceStatus.Draft &&
      nextStatus !== OtherInvoiceStatus.Draft;

    const postedToGl = before.status !== OtherInvoiceStatus.Draft;
    if (postedToGl) {
      if (dto.lines) {
        throw new ConflictException(
          'Cannot change other-invoice lines after GL posting — reverse the journal and re-issue',
        );
      }
      if (
        dto.currencyCode &&
        dto.currencyCode.toUpperCase() !== before.currencyCode
      ) {
        throw new ConflictException(
          'Cannot change currency after GL posting',
        );
      }
    }

    if (
      postedToGl &&
      dto.status === OtherInvoiceStatus.Draft
    ) {
      throw new BadRequestException('Cannot revert a posted invoice to Draft');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        await tx.otherInvoiceLine.deleteMany({ where: { otherInvoiceId: id } });
      }
      const invoice = await tx.otherInvoice.update({
        where: { id },
        data: {
          invoiceDate,
          ...(dto.billTo !== undefined ? { billTo: dto.billTo.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
          ...(dto.currencyCode
            ? { currencyCode: dto.currencyCode.toUpperCase() }
            : {}),
          status: nextStatus,
          ...(dto.notes !== undefined
            ? { notes: dto.notes?.trim() || null }
            : {}),
          ...(dto.lines
            ? {
                lines: {
                  create: dto.lines.map((l, i) => ({
                    lineNo: i + 1,
                    description: l.description.trim(),
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    lineTotal: round2(l.quantity * l.unitPrice),
                  })),
                },
              }
            : {}),
        },
        include,
      });

      if (leavingDraft) {
        const fx = await this.gl.getFxRateToPkr(
          invoice.currencyCode,
          invoiceDate,
        );
        await this.gl.postOtherInvoiceAccrual(tx, {
          otherInvoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          branchId: invoice.branchId,
          entryDate: invoiceDate,
          amountPkr: round2(this.total(invoice.lines) * fx),
          actorId: user.id,
        });
      }
      return invoice;
    });

    await this.audit.log({
      userId: user.id,
      action: leavingDraft ? 'SEND' : 'UPDATE',
      module: 'Other Invoices',
      entityType: 'OtherInvoice',
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: row.status },
    });
    return row;
  }

  async softDelete(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    await this.fiscal.assertNotLocked(before.invoiceDate);

    await this.prisma.$transaction(async (tx) => {
      await this.gl.reverseSourceJournal(tx, {
        sourceType: JournalSourceType.OtherInvoice,
        sourceId: id,
        reverseDate: new Date(),
        reason: `Reversal on delete of other invoice ${before.invoiceNo}`,
        actorId: user.id,
      });
      await tx.otherInvoice.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Other Invoices',
      entityType: 'OtherInvoice',
      entityId: id,
      beforeData: { invoiceNo: before.invoiceNo },
    });
    return { success: true };
  }
}
