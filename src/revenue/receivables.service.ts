import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  InvoiceStatus,
  JournalSourceType,
  Prisma,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import {
  ConfirmAllocationDto,
  CreateReceivableDto,
} from './dto/revenue.dto';

const include = {
  invoice: { select: { id: true, invoiceNo: true, status: true, currencyCode: true } },
  bankAccount: { select: { id: true, name: true, bankName: true } },
  branch: { select: { id: true, code: true, name: true } },
  allocations: true,
} satisfies Prisma.ReceivableInclude;

@Injectable()
export class ReceivablesService {
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

  list(scope: RequestBranchScope) {
    return this.prisma.receivable.findMany({
      where: scope.allBranches ? {} : { branchId: scope.branchId! },
      include,
      orderBy: [{ receiptDate: 'desc' }, { receiptNo: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.receivable.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Receivable not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  private async nextReceiptNo(tx: Prisma.TransactionClient) {
    const year = new Date().getFullYear();
    const prefix = `REC-${year}-`;
    const latest = await tx.receivable.findFirst({
      where: { receiptNo: { startsWith: prefix } },
      orderBy: { receiptNo: 'desc' },
    });
    let next = 1;
    if (latest?.receiptNo) {
      const n = parseInt(latest.receiptNo.slice(prefix.length), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private async invoiceOutstanding(invoiceId: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null },
      include: {
        lines: true,
        receivables: { where: { isBulkRemittance: false } },
      },
    });
    if (!inv) throw new BadRequestException('Invoice not found');
    if (inv.status === InvoiceStatus.Draft || inv.status === InvoiceStatus.Closed) {
      throw new BadRequestException('Cannot receive against Draft/Closed invoice');
    }
    const total = round2(
      inv.lines.reduce((s, l) => s + Number(l.commissionAmount), 0),
    );
    const paid = round2(
      inv.receivables.reduce((s, r) => s + Number(r.amountReceived), 0),
    );
    return { inv, total, paid, outstanding: round2(total - paid) };
  }

  async create(
    dto: CreateReceivableDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const receiptDate = this.parseDate(dto.receiptDate);
    await this.fiscal.assertNotLocked(receiptDate);

    const isBulk = dto.isBulkRemittance === true;
    if (!isBulk && !dto.invoiceId) {
      throw new BadRequestException('invoiceId required unless bulk remittance');
    }
    if (isBulk && dto.invoiceId) {
      throw new BadRequestException('Bulk remittance must not set invoiceId');
    }

    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, deletedAt: null, isActive: true },
    });
    if (!bank) throw new BadRequestException('Invalid bank account');

    const currencyCode = dto.currencyCode.toUpperCase();
    const currency = await this.prisma.currency.findUnique({
      where: { code: currencyCode },
    });
    if (!currency) {
      throw new BadRequestException(`Unknown currency ${currencyCode}`);
    }

    let invoiceNo: string | undefined;
    let arClearedPkr: number | undefined;
    if (!isBulk && dto.invoiceId) {
      const { outstanding, inv } = await this.invoiceOutstanding(dto.invoiceId);
      if (dto.amountReceived > outstanding + 0.001) {
        throw new BadRequestException(
          `Amount exceeds outstanding ${outstanding}`,
        );
      }
      invoiceNo = inv.invoiceNo;
      if (inv.branchId !== branchId) {
        throw new BadRequestException('Invoice branch mismatch');
      }
      const invFx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : dto.exchangeRate;
      arClearedPkr = round2(dto.amountReceived * invFx);
    }

    const whtRate = await this.gl.getWhtRateFraction();
    const gross = round2(dto.amountReceived * dto.exchangeRate);
    const wht = round2(gross * whtRate);
    const net = round2(gross - wht);
    const isPartial =
      dto.isPartial ??
      (!isBulk && dto.invoiceId
        ? (await this.invoiceOutstanding(dto.invoiceId)).outstanding -
            dto.amountReceived >
          0.001
        : false);

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const receiptNo = await this.nextReceiptNo(tx);
        const receivable = await tx.receivable.create({
          data: {
            receiptNo,
            branchId,
            invoiceId: isBulk ? null : dto.invoiceId!,
            bankAccountId: dto.bankAccountId,
            currencyCode,
            amountReceived: dto.amountReceived,
            exchangeRate: dto.exchangeRate,
            amountPkrGross: gross,
            whtAmountPkr: wht,
            amountPkrNet: net,
            receiptDate,
            reconciliationStatus:
              dto.reconciliationStatus ?? ReconciliationStatus.Unmatched,
            isPartial,
            isBulkRemittance: isBulk,
            allocationStatus: isBulk ? AllocationStatus.pending : null,
            notes: dto.notes?.trim() || null,
            createdById: user.id,
          },
          include,
        });

        if (isBulk) {
          await this.gl.postBulkRemittance(tx, {
            receivableId: receivable.id,
            receiptNo: receivable.receiptNo,
            branchId,
            entryDate: receiptDate,
            grossPkr: gross,
            whtPkr: wht,
            netPkr: net,
            actorId: user.id,
          });
        } else {
          await this.gl.postReceivableReceipt(tx, {
            receivableId: receivable.id,
            receiptNo: receivable.receiptNo,
            branchId,
            entryDate: receiptDate,
            invoiceNo,
            grossPkr: gross,
            whtPkr: wht,
            netPkr: net,
            arClearedPkr,
            actorId: user.id,
          });
        }

        // Mirror bank deposit (net of WHT) for cash position / reconciliation
        await tx.bankTransaction.create({
          data: {
            bankAccountId: dto.bankAccountId,
            txnDate: receiptDate,
            txnType: 'deposit',
            description: isBulk
              ? `Bulk remittance ${receivable.receiptNo}`
              : `University receipt ${receivable.receiptNo}${invoiceNo ? ` — ${invoiceNo}` : ''}`,
            amount: net,
            currencyCode: 'PKR',
            reconciliationStatus: 'Unmatched',
            sourceType: 'Receivable',
            sourceId: receivable.id,
          },
        });

        return receivable;
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Receipt number or journal already exists — retry',
        );
      }
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid reference (currency, bank, invoice, or branch)',
        );
      }
      throw e;
    }

    if (!isBulk && dto.invoiceId) {
      await this.syncInvoiceStatus(dto.invoiceId);
    }

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Receivables',
      entityType: 'Receivable',
      entityId: row.id,
      afterData: { receiptNo: row.receiptNo, isBulk },
    });

    return this.get(row.id, scope);
  }

  private async syncInvoiceStatus(invoiceId: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null },
      include: {
        lines: true,
        receivables: { where: { isBulkRemittance: false } },
      },
    });
    if (!inv) return;
    if (
      inv.status === InvoiceStatus.Draft ||
      inv.status === InvoiceStatus.Closed
    ) {
      return;
    }
    const total = round2(
      inv.lines.reduce((s, l) => s + Number(l.commissionAmount), 0),
    );
    const paid = round2(
      inv.receivables.reduce((s, r) => s + Number(r.amountReceived), 0),
    );
    let next = inv.status;
    if (paid <= 0.001) next = InvoiceStatus.Sent;
    else if (paid + 0.001 < total) next = InvoiceStatus.PartiallyReceived;
    else next = InvoiceStatus.FullyReceived;
    if (next !== inv.status) {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: next },
      });
    }
  }

  async confirmAllocation(
    receivableId: string,
    dto: ConfirmAllocationDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const bulk = await this.get(receivableId, scope);
    if (!bulk.isBulkRemittance) {
      throw new BadRequestException('Not a bulk remittance');
    }
    if (bulk.allocationStatus === AllocationStatus.allocated) {
      throw new ConflictException('Already allocated');
    }

    const totalAllocated = round2(
      dto.allocations.reduce((s, a) => s + a.allocatedAmount, 0),
    );
    if (Math.abs(totalAllocated - Number(bulk.amountReceived)) > 0.001) {
      throw new BadRequestException(
        `Allocations (${totalAllocated}) must equal remittance (${bulk.amountReceived})`,
      );
    }

    await this.fiscal.assertNotLocked(bulk.receiptDate);
    const whtRate = await this.gl.getWhtRateFraction();

    const result = await this.prisma.$transaction(async (tx) => {
      const childIds: string[] = [];

      for (const alloc of dto.allocations) {
        const { outstanding, inv } = await this.invoiceOutstanding(alloc.invoiceId);
        if (alloc.allocatedAmount > outstanding + 0.001) {
          throw new BadRequestException(
            `Allocation to ${inv.invoiceNo} exceeds outstanding`,
          );
        }

        const gross = round2(alloc.allocatedAmount * Number(bulk.exchangeRate));
        const wht = round2(gross * whtRate);
        const net = round2(gross - wht);
        const invFx =
          inv.exchangeRate != null
            ? Number(inv.exchangeRate)
            : Number(bulk.exchangeRate);
        const arClearedPkr = round2(alloc.allocatedAmount * invFx);
        const receiptNo = await this.nextReceiptNo(tx);

        const child = await tx.receivable.create({
          data: {
            receiptNo,
            branchId: bulk.branchId,
            invoiceId: alloc.invoiceId,
            bankAccountId: bulk.bankAccountId,
            currencyCode: bulk.currencyCode,
            amountReceived: alloc.allocatedAmount,
            exchangeRate: bulk.exchangeRate,
            amountPkrGross: gross,
            whtAmountPkr: wht,
            amountPkrNet: net,
            receiptDate: bulk.receiptDate,
            reconciliationStatus: bulk.reconciliationStatus,
            isPartial: alloc.allocatedAmount + 0.001 < outstanding,
            isBulkRemittance: false,
            notes: `Allocated from ${bulk.receiptNo}`,
            createdById: user.id,
          },
        });
        childIds.push(child.id);

        await tx.receivableAllocation.create({
          data: {
            receivableId,
            invoiceId: alloc.invoiceId,
            allocatedAmount: alloc.allocatedAmount,
            currencyCode: bulk.currencyCode,
            allocatedAmountPkr: gross,
          },
        });

        await this.gl.postReceivableReceipt(tx, {
          receivableId: child.id,
          receiptNo: child.receiptNo,
          branchId: bulk.branchId,
          entryDate: bulk.receiptDate,
          invoiceNo: inv.invoiceNo,
          grossPkr: gross,
          whtPkr: wht,
          netPkr: net,
          arClearedPkr,
          fromClearing: true,
          actorId: user.id,
        });
      }

      await tx.receivable.update({
        where: { id: receivableId },
        data: { allocationStatus: AllocationStatus.allocated },
      });

      return childIds;
    });

    for (const a of dto.allocations) {
      await this.syncInvoiceStatus(a.invoiceId);
    }

    await this.audit.log({
      userId: user.id,
      action: 'ALLOCATE',
      module: 'Allocation',
      entityType: 'Receivable',
      entityId: receivableId,
      afterData: { children: result.length },
    });

    return this.get(receivableId, scope);
  }

  async softDelete(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    await this.fiscal.assertNotLocked(before.receiptDate);
    if (before.isBulkRemittance && before.allocationStatus === AllocationStatus.allocated) {
      throw new ConflictException('Cannot delete allocated bulk remittance');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.gl.reverseSourceJournal(tx, {
        sourceType: before.isBulkRemittance
          ? JournalSourceType.BulkReceivable
          : JournalSourceType.Receivable,
        sourceId: id,
        reverseDate: before.receiptDate,
        reason: `Reversal on delete of receipt ${before.receiptNo}`,
        actorId: user.id,
      });
      await tx.receivableAllocation.deleteMany({
        where: { receivableId: id },
      });
      await tx.receivable.delete({ where: { id } });
    });
    if (before.invoiceId) {
      await this.syncInvoiceStatus(before.invoiceId);
    }
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Receivables',
      entityType: 'Receivable',
      entityId: id,
      beforeData: { receiptNo: before.receiptNo },
    });
    return { success: true };
  }
}
