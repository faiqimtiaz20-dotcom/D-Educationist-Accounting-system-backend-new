import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, PayrollRunStatus, Prisma, TaxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { CreateTaxRecordDto, UpdateTaxRecordDto } from './dto/tax.dto';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const TAX_LABEL: Record<TaxType, string> = {
  WhtReceivable: 'WHT Receivable',
  WhtPayable: 'WHT Payable',
  GstInput: 'GST Input',
  GstOutput: 'GST Output',
  SrbSst: 'SRB-SST',
  SalaryTax: 'Salary Tax',
};

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export type TaxRecordRow = {
  id: string;
  taxType: TaxType;
  type: string;
  period: string;
  periodLabel: string;
  amount: number;
  branchId: string;
  source: 'aggregated' | 'manual';
  sourceType: string | null;
  sourceId: string | null;
};

@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertBranch(scope: RequestBranchScope, branchId: string) {
    if (!scope.allBranches && scope.branchId !== branchId) {
      throw new ForbiddenException('Cross-branch access is not allowed');
    }
  }

  private parsePeriod(period?: string) {
    const p = (period ?? '').trim();
    if (!PERIOD_RE.test(p)) {
      throw new BadRequestException('period is required as YYYY-MM');
    }
    const [y, m] = p.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    return { period: p, from, to, label: `${MONTH_SHORT[m - 1]} ${y}` };
  }

  private branchFilter(scope: RequestBranchScope): Prisma.StringFilter | string | undefined {
    if (scope.allBranches) return undefined;
    return scope.branchId ?? undefined;
  }

  private emptyTotals() {
    return {
      whtReceivable: 0,
      whtPayable: 0,
      gstInput: 0,
      gstOutput: 0,
      srbSst: 0,
      salaryTax: 0,
    };
  }

  private addToBucket(
    buckets: Map<string, number>,
    taxType: TaxType,
    branchId: string,
    amount: number,
  ) {
    if (amount === 0) return;
    const key = `${taxType}|${branchId}`;
    buckets.set(key, round2((buckets.get(key) ?? 0) + amount));
  }

  /** Live aggregation from source documents + manual tax_records for a period. */
  async summary(scope: RequestBranchScope, periodRaw?: string) {
    const { period, from, to, label } = this.parsePeriod(periodRaw);
    const branchId = this.branchFilter(scope);
    const buckets = new Map<string, number>();

    // WHT Receivable — university remittances
    const remittances = await this.prisma.receivable.findMany({
      where: {
        receiptDate: { gte: from, lt: to },
        ...(branchId ? { branchId } : {}),
        whtAmountPkr: { gt: 0 },
      },
      select: { branchId: true, whtAmountPkr: true },
    });
    for (const r of remittances) {
      this.addToBucket(
        buckets,
        TaxType.WhtReceivable,
        r.branchId,
        Number(r.whtAmountPkr),
      );
    }

    // WHT Payable — sub-agent payments (cash-basis share of commission WHT)
    const payments = await this.prisma.subAgentPayment.findMany({
      where: {
        paymentDate: { gte: from, lt: to },
        ...(branchId
          ? { commission: { branchId: branchId as string } }
          : {}),
      },
      include: {
        commission: {
          select: { branchId: true, whtPkr: true, payablePkrNet: true },
        },
      },
    });
    for (const p of payments) {
      const net = Number(p.commission.payablePkrNet);
      const wht = Number(p.commission.whtPkr);
      if (net <= 0 || wht <= 0) continue;
      const share = round2((Number(p.amountPkr) / net) * wht);
      this.addToBucket(buckets, TaxType.WhtPayable, p.commission.branchId, share);
    }

    // Vendor income tax on approved expenses → WHT Payable
    const expensesIt = await this.prisma.expense.findMany({
      where: {
        expenseDate: { gte: from, lt: to },
        approvalStatus: ApprovalStatus.Approved,
        ...(branchId ? { branchId } : {}),
        incomeTax: { gt: 0 },
      },
      select: { branchId: true, incomeTax: true },
    });
    for (const e of expensesIt) {
      this.addToBucket(buckets, TaxType.WhtPayable, e.branchId, Number(e.incomeTax));
    }

    // Vendor WHT on petty cash outflows → WHT Payable
    const pettyIt = await this.prisma.pettyCashEntry.findMany({
      where: {
        entryDate: { gte: from, lt: to },
        entryType: 'out',
        ...(branchId ? { branchId } : {}),
        incomeTax: { gt: 0 },
      },
      select: { branchId: true, incomeTax: true },
    });
    for (const p of pettyIt) {
      this.addToBucket(buckets, TaxType.WhtPayable, p.branchId, Number(p.incomeTax));
    }

    // GST Input + SRB-SST from approved expenses
    const expenses = await this.prisma.expense.findMany({
      where: {
        expenseDate: { gte: from, lt: to },
        approvalStatus: ApprovalStatus.Approved,
        ...(branchId ? { branchId } : {}),
      },
      select: { branchId: true, gst: true, salesTax: true, srbSst: true },
    });
    for (const e of expenses) {
      const gstIn = round2(Number(e.gst) + Number(e.salesTax));
      this.addToBucket(buckets, TaxType.GstInput, e.branchId, gstIn);
      this.addToBucket(buckets, TaxType.SrbSst, e.branchId, Number(e.srbSst));
    }

    // GST Input + SRB-SST from petty cash (out)
    const petty = await this.prisma.pettyCashEntry.findMany({
      where: {
        entryDate: { gte: from, lt: to },
        entryType: 'out',
        ...(branchId ? { branchId } : {}),
      },
      select: { branchId: true, gst: true, salesTax: true, srbSst: true },
    });
    for (const p of petty) {
      const gstIn = round2(Number(p.gst) + Number(p.salesTax));
      this.addToBucket(buckets, TaxType.GstInput, p.branchId, gstIn);
      this.addToBucket(buckets, TaxType.SrbSst, p.branchId, Number(p.srbSst));
    }

    // Salary tax from processed/paid payroll runs
    const payrollLines = await this.prisma.payrollLine.findMany({
      where: {
        salaryTax: { gt: 0 },
        payrollRun: {
          period,
          status: { in: [PayrollRunStatus.Processed, PayrollRunStatus.Paid] },
          ...(branchId ? { branchId } : {}),
        },
      },
      include: { payrollRun: { select: { branchId: true } } },
    });
    for (const line of payrollLines) {
      this.addToBucket(
        buckets,
        TaxType.SalaryTax,
        line.payrollRun.branchId,
        Number(line.salaryTax),
      );
    }

    // Manual adjustments (listed separately; included in totals)
    const manuals = await this.prisma.taxRecord.findMany({
      where: {
        period,
        ...(branchId ? { branchId } : {}),
        sourceType: 'Manual',
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: [{ taxType: 'asc' }, { createdAt: 'asc' }],
    });

    const totals = this.emptyTotals();
    const aggregatedRows: TaxRecordRow[] = [];

    const bumpTotal = (taxType: TaxType, amount: number) => {
      switch (taxType) {
        case TaxType.WhtReceivable:
          totals.whtReceivable = round2(totals.whtReceivable + amount);
          break;
        case TaxType.WhtPayable:
          totals.whtPayable = round2(totals.whtPayable + amount);
          break;
        case TaxType.GstInput:
          totals.gstInput = round2(totals.gstInput + amount);
          break;
        case TaxType.GstOutput:
          totals.gstOutput = round2(totals.gstOutput + amount);
          break;
        case TaxType.SrbSst:
          totals.srbSst = round2(totals.srbSst + amount);
          break;
        case TaxType.SalaryTax:
          totals.salaryTax = round2(totals.salaryTax + amount);
          break;
      }
    };

    // `buckets` already holds live source totals (before manuals)
    for (const [key, amount] of buckets) {
      if (amount === 0) continue;
      const [taxType, bId] = key.split('|') as [TaxType, string];
      bumpTotal(taxType, amount);
      aggregatedRows.push({
        id: `agg:${taxType}:${period}:${bId}`,
        taxType,
        type: TAX_LABEL[taxType],
        period,
        periodLabel: label,
        amount,
        branchId: bId,
        source: 'aggregated',
        sourceType: 'Aggregated',
        sourceId: null,
      });
    }

    const manualRows: TaxRecordRow[] = manuals.map((m) => {
      const amount = Number(m.amount);
      bumpTotal(m.taxType, amount);
      return {
        id: m.id,
        taxType: m.taxType,
        type: TAX_LABEL[m.taxType],
        period: m.period,
        periodLabel: label,
        amount,
        branchId: m.branchId,
        source: 'manual' as const,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
      };
    });

    const records = [...aggregatedRows, ...manualRows].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.branchId.localeCompare(b.branchId);
    });

    const totalLiability = round2(
      totals.whtPayable + totals.gstOutput + totals.srbSst + totals.salaryTax,
    );
    const totalReceivable = round2(totals.whtReceivable + totals.gstInput);

    return {
      period,
      periodLabel: label,
      ...totals,
      totalLiability,
      totalReceivable,
      gstNet: round2(totals.gstOutput - totals.gstInput),
      records,
    };
  }

  async listRecords(
    scope: RequestBranchScope,
    opts: { period?: string; taxType?: TaxType },
  ) {
    const summary = await this.summary(scope, opts.period);
    let records = summary.records;
    if (opts.taxType) {
      records = records.filter((r) => r.taxType === opts.taxType);
    }
    return records;
  }

  async listManual(scope: RequestBranchScope, periodRaw?: string) {
    const { period } = this.parsePeriod(periodRaw);
    const branchId = this.branchFilter(scope);
    return this.prisma.taxRecord.findMany({
      where: {
        period,
        sourceType: 'Manual',
        ...(branchId ? { branchId } : {}),
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createManual(
    dto: CreateTaxRecordDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    this.assertBranch(scope, dto.branchId);
    this.parsePeriod(dto.period);

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const id = randomUUID();
    const row = await this.prisma.taxRecord.create({
      data: {
        id,
        taxType: dto.taxType,
        period: dto.period,
        branchId: dto.branchId,
        amount: round2(dto.amount),
        sourceType: 'Manual',
        sourceId: id,
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Tax Compliance',
      entityType: 'TaxRecord',
      entityId: row.id,
      afterData: {
        taxType: row.taxType,
        period: row.period,
        amount: Number(row.amount),
        note: dto.note ?? null,
      },
    });

    return row;
  }

  async updateManual(
    id: string,
    dto: UpdateTaxRecordDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const existing = await this.prisma.taxRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tax record not found');
    if (existing.sourceType !== 'Manual') {
      throw new BadRequestException('Only manual tax adjustments can be edited');
    }
    this.assertBranch(scope, existing.branchId);

    const row = await this.prisma.taxRecord.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined ? { amount: round2(dto.amount) } : {}),
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Tax Compliance',
      entityType: 'TaxRecord',
      entityId: id,
      beforeData: { amount: Number(existing.amount) },
      afterData: { amount: Number(row.amount), note: dto.note ?? null },
    });

    return row;
  }

  async deleteManual(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const existing = await this.prisma.taxRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tax record not found');
    if (existing.sourceType !== 'Manual') {
      throw new BadRequestException('Only manual tax adjustments can be deleted');
    }
    this.assertBranch(scope, existing.branchId);

    await this.prisma.taxRecord.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Tax Compliance',
      entityType: 'TaxRecord',
      entityId: id,
      beforeData: {
        taxType: existing.taxType,
        period: existing.period,
        amount: Number(existing.amount),
      },
    });

    return { ok: true };
  }
}
