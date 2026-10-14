import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { runGlTransaction } from '../common/gl-transaction';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import {
  ConfirmAllocationDto,
  CreateReceivableDto,
  UpdateReceivableDto,
} from './dto/revenue.dto';
import { rethrowPrismaAsHttp } from '../common/prisma-http';

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
      row = await runGlTransaction(this.prisma, async (tx) => {
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
      rethrowPrismaAsHttp(e);
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

  /**
   * Update remittance (amount / FX / bank / date). Reverses the prior JE so a
   * corrected receipt can re-post — FX gain/loss then reflect the new rate.
   */
  async update(
    id: string,
    dto: UpdateReceivableDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    if (
      before.isBulkRemittance &&
      before.allocationStatus === AllocationStatus.allocated
    ) {
      throw new ConflictException(
        'Cannot edit an allocated bulk remittance — reverse allocations first',
      );
    }

    const amountReceived =
      dto.amountReceived !== undefined
        ? Number(dto.amountReceived)
        : Number(before.amountReceived);
    const exchangeRate =
      dto.exchangeRate !== undefined
        ? Number(dto.exchangeRate)
        : Number(before.exchangeRate);
    const bankAccountId = dto.bankAccountId ?? before.bankAccountId;
    const currencyCode = (
      dto.currencyCode ?? before.currencyCode
    ).toUpperCase();
    const receiptDate = dto.receiptDate
      ? this.parseDate(dto.receiptDate)
      : before.receiptDate;

    if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate < 0) {
      throw new BadRequestException('Invalid exchange rate');
    }

    await this.fiscal.assertNotLocked(before.receiptDate);
    await this.fiscal.assertNotLocked(receiptDate);

    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, deletedAt: null, isActive: true },
    });
    if (!bank) throw new BadRequestException('Invalid bank account');

    const currency = await this.prisma.currency.findUnique({
      where: { code: currencyCode },
    });
    if (!currency) {
      throw new BadRequestException(`Unknown currency ${currencyCode}`);
    }

    let invoiceNo: string | undefined;
    let arClearedPkr: number | undefined;
    if (!before.isBulkRemittance && before.invoiceId) {
      const { outstanding, inv } = await this.invoiceOutstanding(
        before.invoiceId,
      );
      // Outstanding already includes this receipt — free it back for the new amount.
      const available = round2(outstanding + Number(before.amountReceived));
      if (amountReceived > available + 0.001) {
        throw new BadRequestException(
          `Amount exceeds outstanding ${available}`,
        );
      }
      invoiceNo = inv.invoiceNo;
      const invFx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : exchangeRate;
      arClearedPkr = round2(amountReceived * invFx);
    }

    const whtRate = await this.gl.getWhtRateFraction();
    const gross = round2(amountReceived * exchangeRate);
    const wht = round2(gross * whtRate);
    const net = round2(gross - wht);
    const isPartial =
      dto.isPartial ??
      (!before.isBulkRemittance && before.invoiceId
        ? round2(
            (await this.invoiceOutstanding(before.invoiceId)).outstanding +
              Number(before.amountReceived) -
              amountReceived,
          ) > 0.001
        : before.isPartial);

    const financialChanged =
      Math.abs(amountReceived - Number(before.amountReceived)) > 1e-9 ||
      Math.abs(exchangeRate - Number(before.exchangeRate)) > 1e-9 ||
      bankAccountId !== before.bankAccountId ||
      currencyCode !== before.currencyCode ||
      receiptDate.getTime() !== before.receiptDate.getTime();

    let row;
    try {
      row = await runGlTransaction(this.prisma, async (tx) => {
        if (financialChanged) {
          await this.gl.reverseSourceJournal(tx, {
            sourceType: before.isBulkRemittance
              ? JournalSourceType.BulkReceivable
              : JournalSourceType.Receivable,
            sourceId: id,
            reverseDate: receiptDate,
            reason: `Reversal on edit of receipt ${before.receiptNo}`,
            actorId: user.id,
          });
        }

        const updated = await tx.receivable.update({
          where: { id },
          data: {
            bankAccountId,
            currencyCode,
            amountReceived,
            exchangeRate,
            amountPkrGross: gross,
            whtAmountPkr: wht,
            amountPkrNet: net,
            receiptDate,
            ...(dto.reconciliationStatus !== undefined
              ? { reconciliationStatus: dto.reconciliationStatus }
              : {}),
            isPartial,
            ...(dto.notes !== undefined
              ? { notes: dto.notes?.trim() || null }
              : {}),
          },
          include,
        });

        if (financialChanged) {
          // Allocated children settle from clearing, not bank.
          const fromClearing = Boolean(
            before.notes?.startsWith('Allocated from '),
          );

          if (before.isBulkRemittance) {
            await this.gl.postBulkRemittance(tx, {
              receivableId: id,
              receiptNo: updated.receiptNo,
              branchId: updated.branchId,
              entryDate: receiptDate,
              grossPkr: gross,
              whtPkr: wht,
              netPkr: net,
              actorId: user.id,
            });
          } else {
            await this.gl.postReceivableReceipt(tx, {
              receivableId: id,
              receiptNo: updated.receiptNo,
              branchId: updated.branchId,
              entryDate: receiptDate,
              invoiceNo,
              grossPkr: gross,
              whtPkr: wht,
              netPkr: net,
              arClearedPkr,
              fromClearing,
              actorId: user.id,
            });
          }

          const bankTxnDesc = before.isBulkRemittance
            ? `Bulk remittance ${updated.receiptNo}`
            : `University receipt ${updated.receiptNo}${invoiceNo ? ` — ${invoiceNo}` : ''}`;

          const existingTxn = await tx.bankTransaction.findFirst({
            where: { sourceType: 'Receivable', sourceId: id },
          });
          if (fromClearing) {
            // Clearing settlements have no bank deposit at child level.
            if (existingTxn) {
              await tx.bankTransaction.delete({ where: { id: existingTxn.id } });
            }
          } else if (existingTxn) {
            await tx.bankTransaction.update({
              where: { id: existingTxn.id },
              data: {
                bankAccountId,
                txnDate: receiptDate,
                description: bankTxnDesc,
                amount: net,
              },
            });
          } else {
            await tx.bankTransaction.create({
              data: {
                bankAccountId,
                txnDate: receiptDate,
                txnType: 'deposit',
                description: bankTxnDesc,
                amount: net,
                currencyCode: 'PKR',
                reconciliationStatus: 'Unmatched',
                sourceType: 'Receivable',
                sourceId: id,
              },
            });
          }
        }

        return updated;
      });
    } catch (e) {
      rethrowPrismaAsHttp(e);
    }

    if (before.invoiceId) {
      await this.syncInvoiceStatus(before.invoiceId);
    }

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Receivables',
      entityType: 'Receivable',
      entityId: id,
      beforeData: {
        amountReceived: Number(before.amountReceived),
        exchangeRate: Number(before.exchangeRate),
      },
      afterData: {
        amountReceived,
        exchangeRate,
        financialChanged,
      },
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

    const result = await runGlTransaction(this.prisma, async (tx) => {
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
    await runGlTransaction(this.prisma, async (tx) => {
      await this.gl.reverseSourceJournal(tx, {
        sourceType: before.isBulkRemittance
          ? JournalSourceType.BulkReceivable
          : JournalSourceType.Receivable,
        sourceId: id,
        reverseDate: before.receiptDate,
        reason: `Reversal on delete of receipt ${before.receiptNo}`,
        actorId: user.id,
      });
      await tx.bankTransaction.deleteMany({
        where: { sourceType: 'Receivable', sourceId: id },
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
