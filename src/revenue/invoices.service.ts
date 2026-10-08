import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, JournalSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import {
  GlPostingService,
  lineCommissionAmount,
  round2,
} from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/revenue.dto';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import {
  applyInvoiceTemplate,
  buildInvoiceHtml,
} from '../settings/invoice-branding';
import { rethrowPrismaAsHttp } from '../common/prisma-http';

const invoiceInclude = {
  lines: {
    include: {
      student: { select: { id: true, studentCode: true, fullName: true } },
    },
    orderBy: { lineNo: 'asc' as const },
  },
  university: { select: { id: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  receivables: {
    where: { isBulkRemittance: false },
    select: { id: true, amountReceived: true, receiptNo: true },
  },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoicesService {
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
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date ${raw}`);
    }
    return d;
  }

  private invoiceTotal(
    lines: Array<{ commissionAmount: Prisma.Decimal | number }>,
  ) {
    return round2(
      lines.reduce((s, l) => s + Number(l.commissionAmount), 0),
    );
  }

  async list(scope: RequestBranchScope, status?: InvoiceStatus) {
    return this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
        ...(status ? { status } : {}),
      },
      include: invoiceInclude,
      orderBy: [{ invoiceDate: 'desc' }, { invoiceNo: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      include: invoiceInclude,
    });
    if (!row) throw new NotFoundException('Invoice not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  private async nextInvoiceNo(branchId: string, tx: Prisma.TransactionClient) {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
    const year = new Date().getFullYear();
    const prefix = `INV-${branch.code}-${year}-`;
    const latest = await tx.invoice.findFirst({
      where: { invoiceNo: { startsWith: prefix } },
      orderBy: { invoiceNo: 'desc' },
      select: { invoiceNo: true },
    });
    let next = 1;
    if (latest?.invoiceNo) {
      const n = parseInt(latest.invoiceNo.slice(prefix.length), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  private async validateLines(
    lines: CreateInvoiceDto['lines'],
    branchId: string,
  ) {
    const studentIds = lines.map((l) => l.studentId);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student on invoice lines');
    }
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, deletedAt: null },
    });
    if (students.length !== studentIds.length) {
      throw new BadRequestException('One or more students are invalid');
    }
    for (const st of students) {
      if (st.branchId !== branchId) {
        throw new BadRequestException(
          `Student ${st.studentCode} belongs to another branch`,
        );
      }
    }
  }

  async create(
    dto: CreateInvoiceDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const invoiceDate = this.parseDate(dto.invoiceDate);
    await this.fiscal.assertNotLocked(invoiceDate);
    await this.validateLines(dto.lines, branchId);

    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.currencyCode.toUpperCase() },
    });
    if (!currency) throw new BadRequestException('Invalid currency');

    if (dto.universityId) {
      const uni = await this.prisma.university.findFirst({
        where: { id: dto.universityId, deletedAt: null },
      });
      if (!uni) throw new BadRequestException('Invalid university');
    }

    const status = dto.status ?? InvoiceStatus.Draft;
    const fx =
      dto.exchangeRate ??
      (await this.gl.getFxRateToPkr(dto.currencyCode, invoiceDate));

    const row = await this.prisma.$transaction(async (tx) => {
      const invoiceNo = await this.nextInvoiceNo(branchId, tx);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo,
          branchId,
          universityId: dto.universityId || null,
          invoiceDate,
          poNumber: dto.poNumber?.trim() || null,
          currencyCode: dto.currencyCode.toUpperCase(),
          status,
          exchangeRate: fx,
          notes: dto.notes?.trim() || null,
          sentAt: status !== InvoiceStatus.Draft ? new Date() : null,
          createdById: user.id,
          lines: {
            create: dto.lines.map((l, i) => ({
              lineNo: i + 1,
              studentId: l.studentId,
              tuitionFee: l.tuitionFee,
              scholarship: l.scholarship ?? 0,
              commissionRate: l.commissionRate,
              bonus: l.bonus ?? 0,
              commissionAmount: lineCommissionAmount(
                l.tuitionFee,
                l.scholarship ?? 0,
                l.commissionRate,
                l.bonus ?? 0,
              ),
            })),
          },
        },
        include: invoiceInclude,
      });

      if (status !== InvoiceStatus.Draft) {
        const total = this.invoiceTotal(invoice.lines);
        const amountPkr = round2(total * Number(fx));
        await this.gl.postInvoiceAccrual(tx, {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          branchId,
          entryDate: invoiceDate,
          amountPkr,
          actorId: user.id,
        });
      }

      return invoice;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Invoices',
      entityType: 'Invoice',
      entityId: row.id,
      afterData: { invoiceNo: row.invoiceNo, status: row.status },
    });

    return this.get(row.id, scope);
  }

  async update(
    id: string,
    dto: UpdateInvoiceDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, scope);
    const invoiceDate = dto.invoiceDate
      ? this.parseDate(dto.invoiceDate)
      : before.invoiceDate;
    await this.fiscal.assertNotLocked(invoiceDate);

    const paid = before.receivables.reduce(
      (s, r) => s + Number(r.amountReceived),
      0,
    );
    const postedToGl = before.status !== InvoiceStatus.Draft;
    if (postedToGl) {
      if (dto.lines) {
        throw new ConflictException(
          'Cannot change invoice lines after GL posting — reverse the invoice journal and re-issue',
        );
      }
      if (
        dto.exchangeRate !== undefined &&
        dto.exchangeRate !== null &&
        Number(before.exchangeRate ?? 0) !== Number(dto.exchangeRate)
      ) {
        throw new ConflictException(
          'Cannot change exchange rate after GL posting',
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
    if (paid > 0 && dto.lines) {
      throw new ConflictException(
        'Cannot change lines after remittance has been recorded',
      );
    }

    if (dto.lines) {
      await this.validateLines(dto.lines, before.branchId);
    }

    const nextStatus = dto.status ?? before.status;
    const wasDraft = before.status === InvoiceStatus.Draft;
    const leavingDraft =
      wasDraft && nextStatus !== InvoiceStatus.Draft;

    if (
      !wasDraft &&
      dto.status === InvoiceStatus.Draft
    ) {
      throw new BadRequestException('Cannot revert a sent invoice to Draft');
    }

    const fx =
      dto.exchangeRate !== undefined && dto.exchangeRate !== null
        ? dto.exchangeRate
        : before.exchangeRate
          ? Number(before.exchangeRate)
          : await this.gl.getFxRateToPkr(
              dto.currencyCode ?? before.currencyCode,
              invoiceDate,
            );

    const fxNum = Number(fx);
    if (!Number.isFinite(fxNum) || fxNum <= 0) {
      throw new BadRequestException(
        'A valid exchange rate is required to send / post this invoice',
      );
    }

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        if (dto.lines) {
          await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        }

        const invoice = await tx.invoice.update({
          where: { id },
          data: {
            ...(dto.universityId !== undefined
              ? { universityId: dto.universityId || null }
              : {}),
            invoiceDate,
            ...(dto.poNumber !== undefined
              ? { poNumber: dto.poNumber?.trim() || null }
              : {}),
            ...(dto.currencyCode
              ? { currencyCode: dto.currencyCode.toUpperCase() }
              : {}),
            status: nextStatus,
            exchangeRate: fxNum,
            ...(dto.notes !== undefined
              ? { notes: dto.notes?.trim() || null }
              : {}),
            ...(leavingDraft ? { sentAt: new Date() } : {}),
            ...(nextStatus === InvoiceStatus.Closed
              ? { closedAt: new Date() }
              : {}),
            ...(dto.lines
              ? {
                  lines: {
                    create: dto.lines.map((l, i) => ({
                      lineNo: i + 1,
                      studentId: l.studentId,
                      tuitionFee: l.tuitionFee,
                      scholarship: l.scholarship ?? 0,
                      commissionRate: l.commissionRate,
                      bonus: l.bonus ?? 0,
                      commissionAmount: lineCommissionAmount(
                        l.tuitionFee,
                        l.scholarship ?? 0,
                        l.commissionRate,
                        l.bonus ?? 0,
                      ),
                    })),
                  },
                }
              : {}),
          },
          include: invoiceInclude,
        });

        if (leavingDraft) {
          const total = this.invoiceTotal(invoice.lines);
          await this.gl.postInvoiceAccrual(tx, {
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            branchId: invoice.branchId,
            entryDate: invoiceDate,
            amountPkr: round2(total * fxNum),
            actorId: user.id,
          });
        }

        return invoice;
      });
    } catch (e) {
      rethrowPrismaAsHttp(e);
    }

    await this.audit.log({
      userId: user.id,
      action: leavingDraft ? 'SEND' : 'UPDATE',
      module: 'Invoices',
      entityType: 'Invoice',
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: row.status },
    });

    return this.syncStatus(id, scope);
  }

  /** Send = Draft → Sent (+ GL). Optionally emails via tenant SMTP. Resend emails again. */
  async send(
    id: string,
    user: AuthUserPayload,
    scope: RequestBranchScope,
    email?: { to?: string; cc?: string; subject?: string; body?: string },
  ) {
    const before = await this.get(id, scope);
    let row = before;

    if (before.status === InvoiceStatus.Draft) {
      try {
        row = await this.update(id, { status: InvoiceStatus.Sent }, user, scope);
      } catch (e) {
        rethrowPrismaAsHttp(e);
      }
    }

    let emailSent = false;
    let emailError: string | null = null;
    const to = email?.to?.trim();
    if (to) {
      try {
        const allSettings = await this.settings.getAll();
        const branding = allSettings.invoiceBranding;
        const orgName = allSettings.orgName || "D' Educationist";
        const logo = await this.settings.readLogoBuffer();
        const studentsLabel = row.lines
          .map((l) => l.student?.fullName || l.studentId)
          .join(', ');
        const uni = row.university?.name || '—';
        const total = this.invoiceTotal(row.lines);
        const paid = row.receivables.reduce(
          (s, r) => s + Number(r.amountReceived),
          0,
        );
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
          students: studentsLabel || '—',
          universities: uni,
          documentTitle: branding.documentTitle,
        };
        const subject =
          email?.subject?.trim() ||
          applyInvoiceTemplate(branding.emailSubject, tplVars);
        const text =
          email?.body?.trim() ||
          applyInvoiceTemplate(branding.emailBody, tplVars);
        const html = buildInvoiceHtml({
          branding,
          orgName,
          invoiceNo: row.invoiceNo,
          invoiceDate,
          currency: row.currencyCode,
          status: row.status,
          lines: row.lines.map((l) => ({
            studentName: l.student?.fullName || l.studentId,
            studentCode: l.student?.studentCode,
            detail: undefined,
            amount: Number(l.commissionAmount),
          })),
          total,
          paid,
          logoDataUrl: logo?.dataUrl ?? null,
        });
        await this.mail.sendMail({
          to,
          cc: email?.cc,
          subject,
          text,
          html,
          attachments: [
            {
              filename: `invoice-${row.invoiceNo}.html`,
              content: Buffer.from(html, 'utf8'),
              contentType: 'text/html',
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
      module: 'Invoices',
      entityType: 'Invoice',
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
        ? 'Invoice sent and email delivered'
        : to
          ? `Invoice updated; email failed: ${emailError}`
          : before.status === InvoiceStatus.Draft
            ? 'Invoice marked Sent (no email address provided)'
            : 'Resend logged (no email address provided)',
    };
  }

  async softDelete(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, scope);
    await this.fiscal.assertNotLocked(before.invoiceDate);
    if (before.receivables.length > 0) {
      throw new ConflictException('Cannot delete invoice with remittances');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.gl.reverseSourceJournal(tx, {
        sourceType: JournalSourceType.Invoice,
        sourceId: id,
        reverseDate: new Date(),
        reason: `Reversal on delete of invoice ${before.invoiceNo}`,
        actorId: user.id,
      });
      await tx.invoice.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Invoices',
      entityType: 'Invoice',
      entityId: id,
      beforeData: { invoiceNo: before.invoiceNo },
    });
    return { success: true };
  }

  /** Recompute Partially/Fully Received from remittances. */
  async syncStatus(id: string, scope: RequestBranchScope) {
    const inv = await this.get(id, scope);
    if (
      inv.status === InvoiceStatus.Draft ||
      inv.status === InvoiceStatus.Closed
    ) {
      return inv;
    }

    const total = this.invoiceTotal(inv.lines);
    const paid = inv.receivables.reduce(
      (s, r) => s + Number(r.amountReceived),
      0,
    );
    let next = inv.status;
    if (paid <= 0.001) next = InvoiceStatus.Sent;
    else if (paid + 0.001 < total) next = InvoiceStatus.PartiallyReceived;
    else next = InvoiceStatus.FullyReceived;

    if (next === inv.status) return inv;

    return this.prisma.invoice.update({
      where: { id },
      data: { status: next },
      include: invoiceInclude,
    });
  }
}
