import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  ApprovalStatus,
  InvoiceStatus,
  Prisma,
  SubAgentCommissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { ROLE_CODES } from '../common/rbac';
import { currentTenantId } from '../common/tenant-scope';

function dayBounds(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const from = new Date(Date.UTC(y, m, day));
  const to = new Date(Date.UTC(y, m, day + 1));
  return { from, to, ymd: from.toISOString().slice(0, 10) };
}

function monthBounds(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  return {
    from,
    to,
    ym: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private branchWhere(scope: RequestBranchScope): string | undefined {
    if (scope.allBranches) return undefined;
    return scope.branchId ?? undefined;
  }

  private async fxToPkr(currencyCode: string, asOf: Date): Promise<number> {
    if (currencyCode === 'PKR') return 1;
    const rate = await this.prisma.fxRate.findFirst({
      where: { currencyCode, effectiveDate: { lte: asOf } },
      orderBy: { effectiveDate: 'desc' },
    });
    if (rate) return Number(rate.rateToPkr);
    const defaults: Record<string, number> = {
      GBP: 355,
      USD: 278,
      CAD: 205,
      AUD: 185,
      EUR: 300,
    };
    return defaults[currencyCode] ?? 1;
  }

  async metrics(scope: RequestBranchScope) {
    const branchId = this.branchWhere(scope);
    const today = dayBounds();
    const month = monthBounds();

    const recWhere: Prisma.ReceivableWhereInput = {
      ...(branchId ? { branchId } : {}),
    };

    const todayCollectionAgg = await this.prisma.receivable.aggregate({
      where: {
        ...recWhere,
        receiptDate: { gte: today.from, lt: today.to },
      },
      _sum: { amountPkrGross: true },
    });

    const expWhere: Prisma.ExpenseWhereInput = {
      approvalStatus: ApprovalStatus.Approved,
      ...(branchId ? { branchId } : {}),
    };

    const todayExpensesAgg = await this.prisma.expense.aggregate({
      where: {
        ...expWhere,
        expenseDate: { gte: today.from, lt: today.to },
      },
      _sum: { total: true },
    });

    const monthlyExpensesAgg = await this.prisma.expense.aggregate({
      where: {
        ...expWhere,
        expenseDate: { gte: month.from, lt: month.to },
      },
      _sum: { total: true },
    });

    // Petty cash
    const petty = await this.prisma.pettyCashEntry.groupBy({
      by: ['entryType'],
      where: branchId ? { branchId } : {},
      _sum: { total: true },
    });
    let pettyIn = 0;
    let pettyOut = 0;
    for (const g of petty) {
      const sum = Number(g._sum.total ?? 0);
      if (g.entryType === 'in') pettyIn += sum;
      else pettyOut += sum;
    }
    const pettyCashBalance = round2(pettyIn - pettyOut);

    // Cash GL 1110 (debit-normal)
    const cashGl = await this.prisma.glAccount.findUnique({
      where: { tenantId_code: { tenantId: currentTenantId(), code: '1110' } },
    });
    let cashBalance = pettyCashBalance;
    if (cashGl) {
      const cashLines = await this.prisma.journalLine.findMany({
        where: {
          glAccountId: cashGl.id,
          journalEntry: {
            tenantId: currentTenantId(),
            approvalStatus: ApprovalStatus.Approved,
            ...(branchId ? { branchId } : {}),
          },
        },
        select: { debit: true, credit: true },
      });
      cashBalance = round2(
        cashLines.reduce(
          (s, l) => s + Number(l.debit) - Number(l.credit),
          0,
        ),
      );
    }

    // Bank balances from accounts + movements
    const accounts = await this.prisma.bankAccount.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true, openingBalance: true },
    });
    let bankBalance = 0;
    for (const a of accounts) {
      const aggs = await this.prisma.bankTransaction.groupBy({
        by: ['txnType'],
        where: { bankAccountId: a.id },
        _sum: { amount: true },
      });
      let movement = 0;
      for (const g of aggs) {
        const sum = Number(g._sum.amount ?? 0);
        if (g.txnType === 'deposit') movement += sum;
        else movement -= sum;
      }
      bankBalance += Number(a.openingBalance) + movement;
    }
    bankBalance = round2(bankBalance);

    // Outstanding AR (PKR)
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { notIn: [InvoiceStatus.Draft, InvoiceStatus.Closed] },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        lines: { select: { commissionAmount: true } },
        receivables: { select: { amountPkrGross: true } },
        allocations: { select: { allocatedAmountPkr: true } },
      },
    });
    let outstandingReceivables = 0;
    for (const inv of invoices) {
      const fx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : await this.fxToPkr(inv.currencyCode, inv.invoiceDate);
      const totalFc = inv.lines.reduce(
        (s, l) => s + Number(l.commissionAmount),
        0,
      );
      const totalPkr = round2(totalFc * fx);
      const paidDirect = inv.receivables.reduce(
        (s, r) => s + Number(r.amountPkrGross),
        0,
      );
      const paidAlloc = inv.allocations.reduce(
        (s, a) => s + Number(a.allocatedAmountPkr),
        0,
      );
      // Prefer allocations when present (bulk remittance); else direct receipts
      const paid = paidAlloc > 0 ? paidAlloc : paidDirect;
      outstandingReceivables += Math.max(0, round2(totalPkr - paid));
    }
    outstandingReceivables = round2(outstandingReceivables);

    // Outstanding AP — unpaid commission net
    const commissions = await this.prisma.subAgentCommission.findMany({
      where: {
        status: {
          in: [
            SubAgentCommissionStatus.Pending,
            SubAgentCommissionStatus.Partial,
          ],
        },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        payments: { select: { amountPkr: true } },
      },
    });
    let outstandingPayables = 0;
    for (const c of commissions) {
      const paid = c.payments.reduce((s, p) => s + Number(p.amountPkr), 0);
      outstandingPayables += Math.max(0, Number(c.payablePkrNet) - paid);
    }
    outstandingPayables = round2(outstandingPayables);

    const todayCollection = round2(
      Number(todayCollectionAgg._sum.amountPkrGross ?? 0),
    );
    const todayExpenses = round2(Number(todayExpensesAgg._sum.total ?? 0));

    // Accrued commission income (sent invoices this month) — aligns with GL 4100 / P&L
    const monthInvoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.Draft },
        invoiceDate: { gte: month.from, lt: month.to },
        ...(branchId ? { branchId } : {}),
      },
      include: { lines: { select: { commissionAmount: true } } },
    });
    let monthlyRevenue = 0;
    for (const inv of monthInvoices) {
      const fx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : await this.fxToPkr(inv.currencyCode, inv.invoiceDate);
      const totalFc = inv.lines.reduce(
        (s, l) => s + Number(l.commissionAmount),
        0,
      );
      monthlyRevenue = round2(monthlyRevenue + totalFc * fx);
    }

    const monthlyExpenses = round2(
      Number(monthlyExpensesAgg._sum.total ?? 0),
    );
    const netProfit = round2(monthlyRevenue - monthlyExpenses);

    return {
      asOf: today.ymd,
      period: month.ym,
      todayCollection,
      todayExpenses,
      cashBalance,
      bankBalance,
      monthlyRevenue,
      monthlyExpenses,
      netProfit,
      outstandingReceivables,
      outstandingPayables,
      pettyCashBalance,
      profitMargin:
        monthlyRevenue > 0
          ? round2((netProfit / monthlyRevenue) * 100)
          : 0,
      expenseRatio:
        monthlyRevenue > 0
          ? round2((monthlyExpenses / monthlyRevenue) * 100)
          : 0,
      totalCashPosition: round2(cashBalance + bankBalance),
    };
  }

  async commissionByUniversity(scope: RequestBranchScope, take = 7) {
    const branchId = this.branchWhere(scope);
    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        invoice: {
          deletedAt: null,
          status: { not: InvoiceStatus.Draft },
          ...(branchId ? { branchId } : {}),
        },
      },
      include: {
        student: {
          include: { university: { select: { name: true } } },
        },
        invoice: { select: { exchangeRate: true, currencyCode: true, invoiceDate: true } },
      },
    });

    const map = new Map<string, number>();
    for (const line of lines) {
      const uni = line.student.university?.name ?? 'Unknown';
      const fx =
        line.invoice.exchangeRate != null
          ? Number(line.invoice.exchangeRate)
          : await this.fxToPkr(
              line.invoice.currencyCode,
              line.invoice.invoiceDate,
            );
      const pkr = round2(Number(line.commissionAmount) * fx);
      map.set(uni, round2((map.get(uni) ?? 0) + pkr));
    }

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, take);
  }

  async receivablesAgeing(scope: RequestBranchScope) {
    const branchId = this.branchWhere(scope);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { notIn: [InvoiceStatus.Draft, InvoiceStatus.Closed] },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        lines: { select: { commissionAmount: true } },
        receivables: { select: { amountPkrGross: true } },
        allocations: { select: { allocatedAmountPkr: true } },
      },
    });

    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const now = Date.now();

    for (const inv of invoices) {
      const fx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : await this.fxToPkr(inv.currencyCode, inv.invoiceDate);
      const totalPkr = round2(
        inv.lines.reduce((s, l) => s + Number(l.commissionAmount), 0) * fx,
      );
      const paidAlloc = inv.allocations.reduce(
        (s, a) => s + Number(a.allocatedAmountPkr),
        0,
      );
      const paidDirect = inv.receivables.reduce(
        (s, r) => s + Number(r.amountPkrGross),
        0,
      );
      const paid = paidAlloc > 0 ? paidAlloc : paidDirect;
      const outstanding = Math.max(0, round2(totalPkr - paid));
      if (outstanding <= 0) continue;
      const days = Math.floor(
        (now - inv.invoiceDate.getTime()) / 86_400_000,
      );
      if (days <= 30) buckets['0-30'] += outstanding;
      else if (days <= 60) buckets['31-60'] += outstanding;
      else if (days <= 90) buckets['61-90'] += outstanding;
      else buckets['90+'] += outstanding;
    }

    const total = Object.values(buckets).reduce((s, v) => s + v, 0);
    return [
      { name: '0-30', value: round2(buckets['0-30']), pct: total ? round2((buckets['0-30'] / total) * 100) : 0 },
      { name: '31-60', value: round2(buckets['31-60']), pct: total ? round2((buckets['31-60'] / total) * 100) : 0 },
      { name: '61-90', value: round2(buckets['61-90']), pct: total ? round2((buckets['61-90'] / total) * 100) : 0 },
      { name: '90+', value: round2(buckets['90+']), pct: total ? round2((buckets['90+'] / total) * 100) : 0 },
    ];
  }

  async branchProfit(scope: RequestBranchScope) {
    // Super-admin sees all branches; others only their own
    const branches = await this.prisma.branch.findMany({
      where: {
        isHeadOffice: false,
        ...(scope.allBranches ? {} : { id: scope.branchId ?? undefined }),
      },
      orderBy: { name: 'asc' },
    });

    const month = monthBounds();
    const result: Array<{ name: string; code: string; profit: number; revenue: number; expenses: number }> = [];

    for (const b of branches) {
      const rev = await this.prisma.receivable.aggregate({
        where: {
          branchId: b.id,
          receiptDate: { gte: month.from, lt: month.to },
        },
        _sum: { amountPkrNet: true },
      });
      const exp = await this.prisma.expense.aggregate({
        where: {
          branchId: b.id,
          approvalStatus: ApprovalStatus.Approved,
          expenseDate: { gte: month.from, lt: month.to },
        },
        _sum: { total: true },
      });
      const revenue = round2(Number(rev._sum.amountPkrNet ?? 0));
      const expenses = round2(Number(exp._sum.total ?? 0));
      result.push({
        name: b.name.replace(/\s+Branch$/i, ''),
        code: b.code,
        revenue,
        expenses,
        profit: round2(revenue - expenses),
      });
    }

    return result.sort((a, b) => b.profit - a.profit);
  }

  async monthlyTrend(scope: RequestBranchScope, months = 7) {
    const branchId = this.branchWhere(scope);
    const now = new Date();
    const rows: Array<{ month: string; period: string; revenue: number; expenses: number }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const from = d;
      const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-PK', { month: 'short', timeZone: 'UTC' });

      const rev = await this.prisma.receivable.aggregate({
        where: {
          ...(branchId ? { branchId } : {}),
          receiptDate: { gte: from, lt: to },
        },
        _sum: { amountPkrNet: true },
      });
      const exp = await this.prisma.expense.aggregate({
        where: {
          ...(branchId ? { branchId } : {}),
          approvalStatus: ApprovalStatus.Approved,
          expenseDate: { gte: from, lt: to },
        },
        _sum: { total: true },
      });

      rows.push({
        month: label,
        period: ym,
        revenue: round2(Number(rev._sum.amountPkrNet ?? 0)),
        expenses: round2(Number(exp._sum.total ?? 0)),
      });
    }

    return rows;
  }

  async counsellorDashboard(user: AuthUserPayload, scope: RequestBranchScope) {
    const isCounsellor = user.roleCode === ROLE_CODES.COUNSELLOR;
    const counsellorId = isCounsellor ? user.id : undefined;

    // Non-counsellors can pass nothing and get empty or all — require counsellor role for this endpoint's "my" view
    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      ...(counsellorId ? { counsellorId } : {}),
      ...(scope.allBranches ? {} : { branchId: scope.branchId ?? undefined }),
    };

    // If not counsellor and not scoped, still allow managers to see? Spec: counsellor dashboard scoped to counsellor.
    // For counsellor role always force own id.
    if (isCounsellor) {
      where.counsellorId = user.id;
    }

    const students = await this.prisma.student.findMany({
      where: isCounsellor
        ? { deletedAt: null, counsellorId: user.id }
        : where,
      include: {
        university: { select: { id: true, name: true, countryName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const statusCounts: Record<string, number> = {};
    for (const st of Object.values(ApplicationStatus)) {
      statusCounts[st] = 0;
    }
    for (const s of students) {
      statusCounts[s.applicationStatus] =
        (statusCounts[s.applicationStatus] ?? 0) + 1;
    }

    const countBy = (key: (s: (typeof students)[0]) => string) => {
      const map = new Map<string, number>();
      for (const s of students) {
        const k = key(s);
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      return Array.from(map, ([name, value]) => ({ name, value })).sort(
        (a, b) => b.value - a.value,
      );
    };

    const activeStudents = students.filter(
      (s) =>
        s.applicationStatus !== ApplicationStatus.Withdrawn &&
        s.applicationStatus !== ApplicationStatus.Deferred,
    ).length;

    return {
      totalStudents: students.length,
      activeStudents,
      offers: statusCounts[ApplicationStatus.Offer] ?? 0,
      enrolled: statusCounts[ApplicationStatus.Enrolled] ?? 0,
      statusChart: Object.entries(statusCounts)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value })),
      intakeChart: countBy((s) => s.intake),
      countryChart: countBy((s) => s.country || s.university?.countryName || 'Unknown'),
      recentStudents: students.slice(0, 8).map((s) => ({
        id: s.id,
        name: s.fullName,
        university: s.university?.name ?? '—',
        intake: s.intake,
        applicationStatus: s.applicationStatus,
      })),
    };
  }
}
