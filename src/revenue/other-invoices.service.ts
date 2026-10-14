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
import { runGlTransaction } from '../common/gl-transaction';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import {
  applyInvoiceTemplate,
  buildInvoiceEmailHtml,
} from '../settings/invoice-branding';
import { buildInvoicePdf } from '../settings/invoice-pdf';
import {
  CreateOtherInvoiceDto,
  RecordOtherInvoicePaymentDto,
  UpdateOtherInvoiceDto,
} from './dto/revenue.dto';

const include = {
  lines: { orderBy: { lineNo: 'asc' as const } },
  branch: { select: { id: true, code: true, name: true } },
  receipts: {
    where: { deletedAt: null },
    orderBy: { receiptDate: 'desc' as const },
  },
} satisfies Prisma.OtherInvoiceInclude;

@Injectable()
export class OtherInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalLockService,
    private readonly gl: GlPostingService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
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
    if (status === OtherInvoiceStatus.Paid) {
      throw new BadRequestException(
        'Use Record payment after Send to mark Paid (posts bank + GL)',
      );
    }
    const fx = await this.gl.getFxRateToPkr(dto.currencyCode, invoiceDate);

    const row = await runGlTransaction(this.prisma, async (tx) => {
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

    if (dto.status === OtherInvoiceStatus.Paid) {
      throw new BadRequestException(
        'Use Record payment to mark an other invoice Paid (posts bank + GL)',
      );
    }

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

    if (
      before.status === OtherInvoiceStatus.Paid ||
      before.status === OtherInvoiceStatus.Closed
    ) {
      throw new ConflictException(
        'Paid / Closed other invoices cannot be edited — reverse the receipt first',
      );
    }

    const row = await runGlTransaction(this.prisma, async (tx) => {
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

    if (before.receipts.length > 0) {
      throw new ConflictException(
        'Delete receipts / reverse payments before deleting this other invoice',
      );
    }

    await runGlTransaction(this.prisma, async (tx) => {
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

  private async nextReceiptNo(branchId: string, tx: Prisma.TransactionClient) {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
    const year = new Date().getFullYear();
    const prefix = `ORCPT-${branch.code}-${year}-`;
    const latest = await tx.otherInvoiceReceipt.findFirst({
      where: { receiptNo: { startsWith: prefix } },
      orderBy: { receiptNo: 'desc' },
    });
    let next = 1;
    if (latest?.receiptNo) {
      const n = parseInt(latest.receiptNo.slice(prefix.length), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  /**
   * Record payment against a Sent other invoice — posts Dr Bank / Cr AR and a bank deposit.
   */
  async recordPayment(
    id: string,
    dto: RecordOtherInvoicePaymentDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const invoice = await this.get(id, scope);
    if (invoice.status !== OtherInvoiceStatus.Sent) {
      throw new BadRequestException(
        'Only Sent other invoices can receive payment',
      );
    }

    const receiptDate = this.parseDate(dto.receiptDate);
    await this.fiscal.assertNotLocked(receiptDate);

    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, deletedAt: null, isActive: true },
    });
    if (!bank) throw new NotFoundException('Bank account not found');
    this.assertBranch(scope, bank.branchId);

    const totalFc = this.total(invoice.lines);
    const paidFc = round2(
      invoice.receipts.reduce((s, r) => s + Number(r.amountReceived), 0),
    );
    const outstandingFc = round2(totalFc - paidFc);
    if (outstandingFc <= 0) {
      throw new BadRequestException('Other invoice is already fully paid');
    }
    if (round2(dto.amountReceived) - outstandingFc > 0.01) {
      throw new BadRequestException(
        `Payment ${dto.amountReceived} exceeds outstanding ${outstandingFc}`,
      );
    }

    const accrualFx = await this.gl.getFxRateToPkr(
      invoice.currencyCode,
      invoice.invoiceDate,
    );
    const receiptFx =
      invoice.currencyCode === 'PKR' ? 1 : Number(dto.exchangeRate);
    if (invoice.currencyCode !== 'PKR' && !(receiptFx > 0)) {
      throw new BadRequestException('Exchange rate is required for non-PKR payments');
    }

    const amountFc = round2(dto.amountReceived);
    const bankPkr = round2(amountFc * receiptFx);
    const arClearedPkr = round2(amountFc * accrualFx);

    const row = await runGlTransaction(this.prisma, async (tx) => {
      const receiptNo = await this.nextReceiptNo(invoice.branchId, tx);
      const receipt = await tx.otherInvoiceReceipt.create({
        data: {
          receiptNo,
          otherInvoiceId: id,
          branchId: invoice.branchId,
          bankAccountId: dto.bankAccountId,
          currencyCode: invoice.currencyCode,
          amountReceived: amountFc,
          exchangeRate: receiptFx,
          amountPkr: bankPkr,
          receiptDate,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
        },
      });

      await this.gl.postOtherInvoiceReceipt(tx, {
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        invoiceNo: invoice.invoiceNo,
        branchId: invoice.branchId,
        entryDate: receiptDate,
        bankPkr,
        arClearedPkr,
        actorId: user.id,
      });

      await tx.bankTransaction.create({
        data: {
          bankAccountId: dto.bankAccountId,
          txnDate: receiptDate,
          txnType: 'deposit',
          description: `Other invoice receipt ${receipt.receiptNo} — ${invoice.invoiceNo}`,
          amount: bankPkr,
          currencyCode: 'PKR',
          reconciliationStatus: 'Unmatched',
          sourceType: 'OtherInvoiceReceipt',
          sourceId: receipt.id,
        },
      });

      const newPaid = round2(paidFc + amountFc);
      const nextStatus =
        newPaid + 0.01 >= totalFc
          ? OtherInvoiceStatus.Paid
          : OtherInvoiceStatus.Sent;

      await tx.otherInvoice.update({
        where: { id },
        data: { status: nextStatus },
      });

      return receipt;
    });

    await this.audit.log({
      userId: user.id,
      action: 'PAY',
      module: 'Other Invoices',
      entityType: 'OtherInvoiceReceipt',
      entityId: row.id,
      afterData: {
        invoiceId: id,
        invoiceNo: invoice.invoiceNo,
        receiptNo: row.receiptNo,
        amountReceived: amountFc,
        amountPkr: bankPkr,
      },
    });

    return this.get(id, scope);
  }

  /** PDF for email attach / download — reuses branding layout with service lines. */
  async buildPdfBuffer(id: string, scope: RequestBranchScope) {
    const row = await this.get(id, scope);
    const allSettings = await this.settings.getAll();
    const branding = {
      ...allSettings.invoiceBranding,
      documentTitle:
        allSettings.invoiceBranding.documentTitle || 'Invoice',
    };
    const orgName = allSettings.orgName || "D' Educationist";
    const logo = await this.settings.readLogoBuffer();
    const total = this.total(row.lines);
    const paid = round2(
      row.receipts.reduce((s, r) => s + Number(r.amountReceived), 0),
    );
    const buffer = await buildInvoicePdf({
      branding,
      orgName,
      invoiceNo: row.invoiceNo,
      invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
      currency: row.currencyCode,
      status: row.status,
      lines: row.lines.map((l) => ({
        studentName: l.description,
        studentCode: null,
        course: null,
        tuitionFee: undefined,
        detail: `${Number(l.quantity)} × ${Number(l.unitPrice)}`,
        amount: Number(l.lineTotal),
      })),
      total,
      paid,
      logoBuffer: logo?.buffer ?? null,
      billTo: {
        name: row.billTo,
        lines: [row.category].filter(Boolean),
      },
    });
    const safeNo = row.invoiceNo.replace(/[^\w.-]+/g, '_');
    return {
      buffer,
      filename: `other-invoice-${safeNo}.pdf`,
      invoiceNo: row.invoiceNo,
    };
  }

  /**
   * Send = Draft → Sent (+ GL accrual). Optionally email via tenant SMTP.
   * Already-Sent invoices can resend when `to` is provided.
   */
  async send(
    id: string,
    user: AuthUserPayload,
    scope: RequestBranchScope,
    email?: { to?: string; cc?: string; subject?: string; body?: string },
  ) {
    const before = await this.get(id, scope);
    if (before.status !== OtherInvoiceStatus.Draft && !email?.to?.trim()) {
      throw new ConflictException('Other invoice already sent');
    }
    let row = before;

    if (before.status === OtherInvoiceStatus.Draft) {
      row = await this.update(
        id,
        { status: OtherInvoiceStatus.Sent },
        user,
        scope,
      );
    }

    let emailSent = false;
    let emailError: string | null = null;
    const to = email?.to?.trim();
    if (to) {
      try {
        const allSettings = await this.settings.getAll();
        const branding = allSettings.invoiceBranding;
        const orgName = allSettings.orgName || "D' Educationist";
        const total = this.total(row.lines);
        const invoiceDate = row.invoiceDate.toISOString().slice(0, 10);
        const amountLabel = `${row.currencyCode} ${total.toLocaleString('en-PK', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
        const tplVars = {
          invoiceNo: row.invoiceNo,
          invoiceDate,
          amount: amountLabel,
          orgName,
          students: row.billTo,
          universities: row.category,
          documentTitle: branding.documentTitle || 'Invoice',
        };
        const subject =
          email?.subject?.trim() ||
          applyInvoiceTemplate(
            branding.emailSubject || 'Invoice {{invoiceNo}}',
            tplVars,
          );
        const text =
          email?.body?.trim() ||
          applyInvoiceTemplate(branding.emailBody || '', tplVars);
        const html = buildInvoiceEmailHtml(text);
        const { buffer: pdf, filename } = await this.buildPdfBuffer(id, scope);
        await this.mail.sendMail({
          to,
          cc: email?.cc,
          subject,
          text,
          html,
          attachments: [
            {
              filename,
              content: pdf,
              contentType: 'application/pdf',
            },
          ],
        });
        emailSent = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
      }
    }

    await this.audit.log({
      userId: user.id,
      action: 'SEND',
      module: 'Other Invoices',
      entityType: 'OtherInvoice',
      entityId: id,
      afterData: {
        invoiceNo: row.invoiceNo,
        emailTo: to || null,
        emailSent,
        emailError,
      },
    });

    return {
      ...row,
      emailSent,
      emailError,
      message: emailSent
        ? 'Other invoice sent and email delivered'
        : to
          ? `Other invoice updated; email failed: ${emailError}`
          : before.status === OtherInvoiceStatus.Draft
            ? 'Other invoice marked Sent (no email address provided)'
            : 'Resend logged (no email address provided)',
    };
  }
}
