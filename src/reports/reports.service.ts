import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  ApprovalStatus,
  InvoiceStatus,
  Prisma,
  SubAgentCommissionStatus,
  TaxType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GlInquiryService } from '../accounting/gl-inquiry.service';
import { TaxService } from '../tax/tax.service';
import { round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { ROLE_CODES } from '../common/rbac';
import { currentTenantId } from '../common/tenant-scope';
import { REPORT_CATALOG, findReportDef, type ReportDef } from './report-catalog';

export type ReportColumn = { key: string; header: string };
export type ReportRow = Record<string, string | number | boolean | null>;

export type ReportPayload = {
  slug: string;
  title: string;
  category: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  details?: { columns: ReportColumn[]; rows: ReportRow[] };
  totals?: Record<string, number>;
  filters: {
    from: string | null;
    to: string | null;
    branchId: string | null;
    period: string | null;
  };
  exportFormats: ['csv'];
};

export type ReportQuery = {
  from?: string;
  to?: string;
  branchId?: string;
  period?: string;
  universityId?: string;
  counsellorId?: string;
  country?: string;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gl: GlInquiryService,
    private readonly tax: TaxService,
  ) {}

  catalog(user: AuthUserPayload): ReportDef[] {
    if (user.roleCode === ROLE_CODES.COUNSELLOR) {
      return REPORT_CATALOG.filter((r) => r.counsellorAllowed);
    }
    return REPORT_CATALOG;
  }

  async run(
    slug: string,
    user: AuthUserPayload,
    scope: RequestBranchScope,
    query: ReportQuery = {},
  ): Promise<ReportPayload> {
    const def = findReportDef(slug);
    if (!def) throw new NotFoundException(`Unknown report: ${slug}`);

    if (
      user.roleCode === ROLE_CODES.COUNSELLOR &&
      !def.counsellorAllowed
    ) {
      throw new ForbiddenException(
        'Counsellors may only open Operations reports',
      );
    }

    const filters = {
      from: query.from?.slice(0, 10) ?? null,
      to: query.to?.slice(0, 10) ?? null,
      branchId: scope.allBranches ? (query.branchId ?? null) : scope.branchId,
      period: query.period ?? null,
    };

    const builder = this.builders[slug];
    if (!builder) throw new NotFoundException(`Report not implemented: ${slug}`);

    const body = await builder.call(this, user, scope, query);
    return {
      slug: def.slug,
      title: def.title,
      category: def.category,
      description: def.description,
      ...body,
      filters,
      exportFormats: ['csv'],
    };
  }

  toCsv(payload: ReportPayload): string {
    const cols = payload.columns;
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      cols.map((c) => escape(c.header)).join(','),
      ...payload.rows.map((row) =>
        cols.map((c) => escape(row[c.key])).join(','),
      ),
    ];
    if (payload.details?.rows.length) {
      lines.push('');
      lines.push('Details');
      lines.push(payload.details.columns.map((c) => escape(c.header)).join(','));
      for (const row of payload.details.rows) {
        lines.push(
          payload.details.columns.map((c) => escape(row[c.key])).join(','),
        );
      }
    }
    return lines.join('\n');
  }

  private branchId(scope: RequestBranchScope): string | undefined {
    return scope.allBranches ? undefined : (scope.branchId ?? undefined);
  }

  private dateRange(from?: string, to?: string) {
    return {
      ...(from ? { gte: new Date(from.slice(0, 10)) } : {}),
      ...(to ? { lte: new Date(to.slice(0, 10)) } : {}),
    };
  }

  private periodBounds(period?: string) {
    const now = new Date();
    const p =
      period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
        ? period
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [y, m] = p.split('-').map(Number);
    return {
      period: p,
      from: new Date(Date.UTC(y, m - 1, 1)),
      to: new Date(Date.UTC(y, m, 1)),
      label: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`,
    };
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

  private async invoiceEarnedPkr(inv: {
    currencyCode: string;
    exchangeRate: Prisma.Decimal | null;
    invoiceDate: Date;
    lines: { commissionAmount: Prisma.Decimal }[];
  }) {
    const fx =
      inv.exchangeRate != null
        ? Number(inv.exchangeRate)
        : await this.fxToPkr(inv.currencyCode, inv.invoiceDate);
    const totalFc = inv.lines.reduce(
      (s, l) => s + Number(l.commissionAmount),
      0,
    );
    return round2(totalFc * fx);
  }

  private builders: Record<
    string,
    (
      this: ReportsService,
      user: AuthUserPayload,
      scope: RequestBranchScope,
      query: ReportQuery,
    ) => Promise<
      Omit<
        ReportPayload,
        'slug' | 'title' | 'category' | 'description' | 'filters' | 'exportFormats'
      >
    >
  > = {
    'branch-income': function (user, scope, query) {
      return this.branchIncome(scope, query);
    },
    'branch-expenses': function (user, scope, query) {
      return this.branchExpenses(scope, query);
    },
    'branch-profit': function (user, scope, query) {
      return this.branchProfit(scope, query);
    },
    'branch-cash': function (user, scope) {
      return this.branchCash(scope);
    },
    'university-wise-pl': function (user, scope, query) {
      return this.universityWisePl(scope, query);
    },
    'consolidated-pl': function (user, scope, query) {
      return this.consolidatedPl(scope, query);
    },
    'consolidated-bs': function (user, scope, query) {
      return this.consolidatedBs(scope, query);
    },
    'consolidated-cf': function (user, scope, query) {
      return this.consolidatedCf(scope, query);
    },
    'trial-balance': function (user, scope, query) {
      return this.trialBalance(scope, query);
    },
    'cash-book': function (user, scope, query) {
      return this.cashBook(scope, query);
    },
    'bank-book': function (user, scope, query) {
      return this.bankBook(scope, query);
    },
    'journal-register': function (user, scope, query) {
      return this.journalRegister(scope, query);
    },
    'expense-report': function (user, scope, query) {
      return this.expenseReport(scope, query);
    },
    'income-report': function (user, scope, query) {
      return this.incomeReport(scope, query);
    },
    'receivable-ageing': function (user, scope) {
      return this.receivableAgeing(scope);
    },
    'payable-ageing': function (user, scope) {
      return this.payableAgeing(scope);
    },
    'petty-cash': function (user, scope, query) {
      return this.pettyCashReport(scope, query);
    },
    'wht-summary': function (user, scope, query) {
      return this.taxSlice(scope, query, [TaxType.WhtReceivable, TaxType.WhtPayable]);
    },
    'gst-summary': function (user, scope, query) {
      return this.taxSlice(scope, query, [
        TaxType.GstInput,
        TaxType.GstOutput,
        TaxType.SrbSst,
      ]);
    },
    'salary-tax': function (user, scope, query) {
      return this.taxSlice(scope, query, [TaxType.SalaryTax]);
    },
    'commission-tracking': function (user, scope, query) {
      return this.commissionTracking(scope, query);
    },
    'subagent-payout': function (user, scope, query) {
      return this.subagentPayout(scope, query);
    },
    'net-margin': function (user, scope, query) {
      return this.netMargin(scope, query);
    },
    counsellor: function (user, scope, query) {
      return this.counsellorPl(user, scope, query);
    },
    'country-wise': function (user, scope, query) {
      return this.destinationPipeline(user, scope, query, 'country');
    },
    'university-wise': function (user, scope, query) {
      return this.destinationPipeline(user, scope, query, 'university');
    },
  };

  private async branchIncome(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.Draft },
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { invoiceDate: dateFilter }
          : {}),
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        university: { select: { name: true, countryName: true, universityNo: true } },
        lines: {
          include: {
            student: { select: { fullName: true, country: true, studentCode: true } },
          },
        },
        receivables: { select: { amountPkrGross: true } },
        allocations: { select: { allocatedAmountPkr: true } },
      },
      orderBy: { invoiceDate: 'desc' },
    });

    const details: ReportRow[] = [];
    const byBranch = new Map<
      string,
      {
        branchId: string;
        branchName: string;
        invoiceCount: number;
        earnedPKR: number;
        receivedPKR: number;
        outstanding: number;
      }
    >();

    for (const inv of invoices) {
      const earnedPKR = await this.invoiceEarnedPkr(inv);
      const received = round2(
        inv.receivables.reduce((s, r) => s + Number(r.amountPkrGross), 0) +
          inv.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0),
      );
      const outstanding = round2(Math.max(0, earnedPKR - received));
      const studentNames = inv.lines
        .map((l) => `${l.student.studentCode} — ${l.student.fullName}`)
        .join(', ');
      details.push({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
        branchId: inv.branchId,
        branchName: inv.branch.name,
        studentName: studentNames || '—',
        university: inv.university
          ? `${inv.university.universityNo} — ${inv.university.name}`
          : '—',
        country: inv.university?.countryName ?? inv.lines[0]?.student.country ?? '—',
        currency: inv.currencyCode,
        commission: round2(
          inv.lines.reduce((s, l) => s + Number(l.commissionAmount), 0),
        ),
        earnedPKR,
        received,
        outstanding,
        status: inv.status,
      });

      const agg = byBranch.get(inv.branchId) ?? {
        branchId: inv.branchId,
        branchName: inv.branch.name,
        invoiceCount: 0,
        earnedPKR: 0,
        receivedPKR: 0,
        outstanding: 0,
      };
      agg.invoiceCount += 1;
      agg.earnedPKR = round2(agg.earnedPKR + earnedPKR);
      agg.receivedPKR = round2(agg.receivedPKR + received);
      agg.outstanding = round2(agg.outstanding + outstanding);
      byBranch.set(inv.branchId, agg);
    }

    const rows = [...byBranch.values()].sort((a, b) => b.earnedPKR - a.earnedPKR);
    return {
      columns: [
        { key: 'branchName', header: 'Branch' },
        { key: 'invoiceCount', header: 'Invoices' },
        { key: 'earnedPKR', header: 'Earned (PKR)' },
        { key: 'receivedPKR', header: 'Received (PKR)' },
        { key: 'outstanding', header: 'Outstanding' },
      ],
      rows,
      details: {
        columns: [
          { key: 'invoiceNo', header: 'Invoice' },
          { key: 'invoiceDate', header: 'Date' },
          { key: 'branchName', header: 'Branch' },
          { key: 'studentName', header: 'Student' },
          { key: 'university', header: 'University' },
          { key: 'earnedPKR', header: 'Earned (PKR)' },
          { key: 'received', header: 'Received' },
          { key: 'outstanding', header: 'Outstanding' },
          { key: 'status', header: 'Status' },
        ],
        rows: details,
      },
      totals: {
        earnedPKR: round2(rows.reduce((s, r) => s + r.earnedPKR, 0)),
        receivedPKR: round2(rows.reduce((s, r) => s + r.receivedPKR, 0)),
        outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
        invoiceCount: details.length,
      },
    };
  }

  private async branchExpenses(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const expenses = await this.prisma.expense.findMany({
      where: {
        approvalStatus: { not: ApprovalStatus.Rejected },
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { expenseDate: dateFilter }
          : {}),
      },
      include: {
        branch: { select: { name: true } },
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { expenseDate: 'desc' },
    });

    const byBranch = new Map<
      string,
      {
        branchId: string;
        branchName: string;
        expenseCount: number;
        totalPKR: number;
        approvedPKR: number;
      }
    >();
    const details: ReportRow[] = expenses.map((e) => {
      const total = Number(e.total);
      const agg = byBranch.get(e.branchId) ?? {
        branchId: e.branchId,
        branchName: e.branch.name,
        expenseCount: 0,
        totalPKR: 0,
        approvedPKR: 0,
      };
      agg.expenseCount += 1;
      agg.totalPKR = round2(agg.totalPKR + total);
      if (e.approvalStatus === ApprovalStatus.Approved) {
        agg.approvedPKR = round2(agg.approvedPKR + total);
      }
      byBranch.set(e.branchId, agg);
      return {
        id: e.id,
        expenseNo: e.expenseNo,
        date: e.expenseDate.toISOString().slice(0, 10),
        branchId: e.branchId,
        branchName: e.branch.name,
        vendor: e.vendor?.name ?? e.vendorName ?? '—',
        category: e.category.name,
        total,
        status: e.approvalStatus,
      };
    });

    const rows = [...byBranch.values()].sort((a, b) => b.totalPKR - a.totalPKR);
    return {
      columns: [
        { key: 'branchName', header: 'Branch' },
        { key: 'expenseCount', header: 'Count' },
        { key: 'totalPKR', header: 'Total (PKR)' },
        { key: 'approvedPKR', header: 'Approved (PKR)' },
      ],
      rows,
      details: {
        columns: [
          { key: 'expenseNo', header: 'Expense ID' },
          { key: 'date', header: 'Date' },
          { key: 'branchName', header: 'Branch' },
          { key: 'vendor', header: 'Vendor' },
          { key: 'category', header: 'Category' },
          { key: 'total', header: 'Total' },
          { key: 'status', header: 'Status' },
        ],
        rows: details,
      },
      totals: {
        totalPKR: round2(rows.reduce((s, r) => s + r.totalPKR, 0)),
        approvedPKR: round2(rows.reduce((s, r) => s + r.approvedPKR, 0)),
        expenseCount: details.length,
      },
    };
  }

  private async branchProfit(scope: RequestBranchScope, query: ReportQuery) {
    const income = await this.branchIncome(scope, query);
    const expenses = await this.branchExpenses(scope, query);
    const incomeBy = new Map(
      income.rows.map((r) => [String(r.branchId), r as ReportRow]),
    );
    const expBy = new Map(
      expenses.rows.map((r) => [String(r.branchId), r as ReportRow]),
    );
    const ids = new Set([...incomeBy.keys(), ...expBy.keys()]);
    const rows: ReportRow[] = [];
    for (const id of ids) {
      const inc = incomeBy.get(id);
      const exp = expBy.get(id);
      const earned = Number(inc?.earnedPKR ?? 0);
      const approvedExp = Number(exp?.approvedPKR ?? 0);
      rows.push({
        branchId: id,
        branchName: String(inc?.branchName ?? exp?.branchName ?? id),
        incomePKR: earned,
        expensesPKR: approvedExp,
        profitPKR: round2(earned - approvedExp),
        invoiceCount: Number(inc?.invoiceCount ?? 0),
        expenseCount: Number(exp?.expenseCount ?? 0),
      });
    }
    rows.sort((a, b) => Number(b.profitPKR) - Number(a.profitPKR));
    return {
      columns: [
        { key: 'branchName', header: 'Branch' },
        { key: 'incomePKR', header: 'Income (PKR)' },
        { key: 'expensesPKR', header: 'Expenses (PKR)' },
        { key: 'profitPKR', header: 'Profit (PKR)' },
        { key: 'invoiceCount', header: 'Invoices' },
        { key: 'expenseCount', header: 'Expenses' },
      ],
      rows,
      totals: {
        incomePKR: round2(rows.reduce((s, r) => s + Number(r.incomePKR), 0)),
        expensesPKR: round2(rows.reduce((s, r) => s + Number(r.expensesPKR), 0)),
        profitPKR: round2(rows.reduce((s, r) => s + Number(r.profitPKR), 0)),
      },
    };
  }

  private async branchCash(scope: RequestBranchScope) {
    const branchId = this.branchId(scope);
    const branches = await this.prisma.branch.findMany({
      where: branchId ? { id: branchId } : { isActive: true },
      orderBy: { name: 'asc' },
    });

    const cashGl = await this.prisma.glAccount.findUnique({
      where: { tenantId_code: { tenantId: currentTenantId(), code: '1110' } },
    });

    const rows: ReportRow[] = [];
    for (const b of branches) {
      const petty = await this.prisma.pettyCashEntry.groupBy({
        by: ['entryType'],
        where: { branchId: b.id },
        _sum: { total: true },
      });
      let pettyIn = 0;
      let pettyOut = 0;
      for (const g of petty) {
        const sum = Number(g._sum.total ?? 0);
        if (g.entryType === 'in') pettyIn += sum;
        else pettyOut += sum;
      }
      const pettyCash = round2(pettyIn - pettyOut);

      let cashGlBal = 0;
      if (cashGl) {
        const lines = await this.prisma.journalLine.findMany({
          where: {
            glAccountId: cashGl.id,
            journalEntry: {
              approvalStatus: ApprovalStatus.Approved,
              branchId: b.id,
            },
          },
          select: { debit: true, credit: true },
        });
        cashGlBal = round2(
          lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
        );
      }

      const accounts = await this.prisma.bankAccount.findMany({
        where: { branchId: b.id, deletedAt: null, isActive: true },
        select: { id: true, openingBalance: true, name: true },
      });
      let bank = 0;
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
        bank = round2(bank + Number(a.openingBalance) + movement);
      }

      rows.push({
        branchId: b.id,
        branchName: b.name,
        pettyCash,
        cashGl: cashGlBal,
        bank,
        totalCash: round2(pettyCash + bank),
      });
    }

    return {
      columns: [
        { key: 'branchName', header: 'Branch' },
        { key: 'pettyCash', header: 'Petty Cash' },
        { key: 'cashGl', header: 'Cash GL (1110)' },
        { key: 'bank', header: 'Bank' },
        { key: 'totalCash', header: 'Total Cash Position' },
      ],
      rows,
      totals: {
        pettyCash: round2(rows.reduce((s, r) => s + Number(r.pettyCash), 0)),
        bank: round2(rows.reduce((s, r) => s + Number(r.bank), 0)),
        totalCash: round2(rows.reduce((s, r) => s + Number(r.totalCash), 0)),
      },
    };
  }

  private async universityWisePl(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.Draft },
        ...(branchId ? { branchId } : {}),
        ...(query.universityId ? { universityId: query.universityId } : {}),
        ...(Object.keys(dateFilter).length
          ? { invoiceDate: dateFilter }
          : {}),
      },
      include: {
        university: { select: { id: true, name: true, countryName: true, universityNo: true } },
        lines: { select: { commissionAmount: true } },
        commissions: {
          select: { payablePkrNet: true, payablePkrGross: true },
        },
      },
    });

    const byUni = new Map<
      string,
      {
        universityId: string;
        university: string;
        country: string;
        incomePKR: number;
        subAgentCostPKR: number;
        profitPKR: number;
        invoiceCount: number;
      }
    >();

    for (const inv of invoices) {
      const key = inv.universityId ?? 'none';
      const earned = await this.invoiceEarnedPkr(inv);
      const cost = round2(
        inv.commissions.reduce((s, c) => s + Number(c.payablePkrGross), 0),
      );
      const row = byUni.get(key) ?? {
        universityId: key,
        universityNo: inv.university?.universityNo ?? '—',
        university: inv.university?.name ?? 'Unassigned',
        country: inv.university?.countryName ?? '—',
        incomePKR: 0,
        subAgentCostPKR: 0,
        profitPKR: 0,
        invoiceCount: 0,
      };
      row.incomePKR = round2(row.incomePKR + earned);
      row.subAgentCostPKR = round2(row.subAgentCostPKR + cost);
      row.profitPKR = round2(row.incomePKR - row.subAgentCostPKR);
      row.invoiceCount += 1;
      byUni.set(key, row);
    }

    const rows = [...byUni.values()].sort((a, b) => b.profitPKR - a.profitPKR);
    return {
      columns: [
        { key: 'universityNo', header: 'University ID' },
        { key: 'university', header: 'University' },
        { key: 'country', header: 'Country' },
        { key: 'invoiceCount', header: 'Invoices' },
        { key: 'incomePKR', header: 'Income (PKR)' },
        { key: 'subAgentCostPKR', header: 'Sub-Agent Cost' },
        { key: 'profitPKR', header: 'Profit (PKR)' },
      ],
      rows,
      totals: {
        incomePKR: round2(rows.reduce((s, r) => s + r.incomePKR, 0)),
        subAgentCostPKR: round2(rows.reduce((s, r) => s + r.subAgentCostPKR, 0)),
        profitPKR: round2(rows.reduce((s, r) => s + r.profitPKR, 0)),
      },
    };
  }

  private async consolidatedPl(scope: RequestBranchScope, query: ReportQuery) {
    const income = await this.branchIncome(scope, query);
    const expenses = await this.branchExpenses(scope, query);
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);

    const incomeBy = new Map(
      income.rows.map((r) => [String(r.branchId), r as ReportRow]),
    );
    const expBy = new Map(
      expenses.rows.map((r) => [String(r.branchId), r as ReportRow]),
    );
    const branchIds = new Set([...incomeBy.keys(), ...expBy.keys()]);
    const profitRows: ReportRow[] = [];
    for (const id of branchIds) {
      const inc = incomeBy.get(id);
      const exp = expBy.get(id);
      const earned = Number(inc?.earnedPKR ?? 0);
      const approvedExp = Number(exp?.approvedPKR ?? 0);
      profitRows.push({
        branchId: id,
        branchName: String(inc?.branchName ?? exp?.branchName ?? id),
        incomePKR: earned,
        expensesPKR: approvedExp,
        profitPKR: round2(earned - approvedExp),
        invoiceCount: Number(inc?.invoiceCount ?? 0),
        expenseCount: Number(exp?.expenseCount ?? 0),
      });
    }
    profitRows.sort((a, b) => Number(b.profitPKR) - Number(a.profitPKR));

    const commissions = await this.prisma.subAgentCommission.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { invoice: { invoiceDate: dateFilter } }
          : {}),
      },
      include: {
        branch: { select: { name: true } },
        student: { select: { fullName: true, studentCode: true } },
        invoice: { select: { invoiceNo: true, invoiceDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const details: ReportRow[] = [];
    for (const inv of income.details?.rows ?? []) {
      details.push({
        id: String(inv.id ?? inv.invoiceNo),
        date: String(inv.invoiceDate ?? ''),
        branchName: String(inv.branchName),
        type: 'Income',
        reference: String(inv.invoiceNo),
        description: `${inv.studentName} — ${inv.university}`,
        amountPKR: Number(inv.earnedPKR),
        status: String(inv.status),
      });
    }
    for (const exp of expenses.details?.rows ?? []) {
      details.push({
        id: String(exp.id ?? exp.expenseNo),
        date: String(exp.date ?? ''),
        branchName: String(exp.branchName),
        type: 'Expense',
        reference: String(exp.expenseNo),
        description: `${exp.vendor} — ${exp.category}`,
        amountPKR: Number(exp.total),
        status: String(exp.status),
      });
    }
    for (const c of commissions) {
      details.push({
        id: c.id,
        date: c.invoice.invoiceDate.toISOString().slice(0, 10),
        branchName: c.branch.name,
        type: 'Sub-Agent Cost',
        reference: c.commissionNo,
        description: `${c.student.studentCode} — ${c.student.fullName} (${c.invoice.invoiceNo})`,
        amountPKR: Number(c.payablePkrGross),
        status: c.status,
      });
    }

    details.sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        String(a.type).localeCompare(String(b.type)),
    );

    const incomeTotal = round2(
      profitRows.reduce((s, r) => s + Number(r.incomePKR), 0),
    );
    const expensesTotal = round2(
      profitRows.reduce((s, r) => s + Number(r.expensesPKR), 0),
    );
    const profitTotal = round2(incomeTotal - expensesTotal);
    const subAgentTotal = round2(
      commissions.reduce((s, c) => s + Number(c.payablePkrGross), 0),
    );

    return {
      columns: [
        { key: 'branchName', header: 'Branch' },
        { key: 'incomePKR', header: 'Income (PKR)' },
        { key: 'expensesPKR', header: 'Expenses (PKR)' },
        { key: 'profitPKR', header: 'Profit (PKR)' },
        { key: 'invoiceCount', header: 'Invoices' },
        { key: 'expenseCount', header: 'Expenses' },
      ],
      rows: profitRows,
      details: {
        columns: [
          { key: 'date', header: 'Date' },
          { key: 'branchName', header: 'Branch' },
          { key: 'type', header: 'Type' },
          { key: 'reference', header: 'Reference' },
          { key: 'description', header: 'Description' },
          { key: 'amountPKR', header: 'Amount (PKR)' },
          { key: 'status', header: 'Status' },
        ],
        rows: details,
      },
      totals: {
        incomePKR: incomeTotal,
        expensesPKR: expensesTotal,
        profitPKR: profitTotal,
        subAgentCostPKR: subAgentTotal,
        netAfterSubAgent: round2(profitTotal - subAgentTotal),
      },
    };
  }

  private async consolidatedBs(scope: RequestBranchScope, query: ReportQuery) {
    const tb = await this.gl.trialBalance(scope, query.from, query.to);
    const rows: ReportRow[] = tb.rows.map((r) => {
      const isAsset = r.type === 'asset';
      const isLiability = r.type === 'liability' || r.type === 'equity';
      const isIncome = r.type === 'income';
      const isExpense = r.type === 'expense';
      let section = 'Other';
      if (isAsset) section = 'Assets';
      else if (isLiability) section = 'Liabilities & Equity';
      else if (isIncome) section = 'Income (P&L)';
      else if (isExpense) section = 'Expenses (P&L)';
      const amount =
        r.balanceDebit > 0 ? r.balanceDebit : -r.balanceCredit;
      return {
        code: r.code,
        name: r.name,
        type: r.type,
        section,
        amount: round2(amount),
        debit: r.balanceDebit,
        credit: r.balanceCredit,
      };
    });

    const assets = round2(
      rows
        .filter((r) => r.section === 'Assets')
        .reduce((s, r) => s + Number(r.amount), 0),
    );
    const liabilities = round2(
      rows
        .filter((r) => r.section === 'Liabilities & Equity')
        .reduce((s, r) => s + Math.abs(Number(r.amount)), 0),
    );

    return {
      columns: [
        { key: 'section', header: 'Section' },
        { key: 'code', header: 'Code' },
        { key: 'name', header: 'Account' },
        { key: 'debit', header: 'Debit' },
        { key: 'credit', header: 'Credit' },
        { key: 'amount', header: 'Signed Amount' },
      ],
      rows,
      totals: {
        assets,
        liabilitiesEquity: liabilities,
        totalDebit: tb.totalDebit,
        totalCredit: tb.totalCredit,
      },
    };
  }

  private async consolidatedCf(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const hasDates = Object.keys(dateFilter).length > 0;

    const receipts = await this.prisma.receivable.aggregate({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(hasDates ? { receiptDate: dateFilter } : {}),
      },
      _sum: { amountPkrNet: true },
    });
    const expenses = await this.prisma.expense.aggregate({
      where: {
        approvalStatus: ApprovalStatus.Approved,
        ...(branchId ? { branchId } : {}),
        ...(hasDates ? { expenseDate: dateFilter } : {}),
      },
      _sum: { total: true },
    });
    const payouts = await this.prisma.subAgentPayment.aggregate({
      where: {
        ...(branchId ? { commission: { branchId } } : {}),
        ...(hasDates ? { paymentDate: dateFilter } : {}),
      },
      _sum: { amountPkr: true },
    });
    const payroll = await this.prisma.payrollRun.findMany({
      where: {
        status: { in: ['Processed', 'Paid'] },
        ...(branchId ? { branchId } : {}),
        ...(query.from || query.to
          ? {
              period: {
                ...(query.from ? { gte: query.from.slice(0, 7) } : {}),
                ...(query.to ? { lte: query.to.slice(0, 7) } : {}),
              },
            }
          : {}),
      },
      select: { totalNet: true },
    });
    const payrollOut = round2(
      payroll.reduce((s, r) => s + Number(r.totalNet), 0),
    );

    const operatingIn = round2(Number(receipts._sum.amountPkrNet ?? 0));
    const operatingOut = round2(
      Number(expenses._sum.total ?? 0) +
        Number(payouts._sum.amountPkr ?? 0) +
        payrollOut,
    );
    const net = round2(operatingIn - operatingOut);

    const rows: ReportRow[] = [
      {
        section: 'Operating',
        label: 'Collections (receivables net)',
        amount: operatingIn,
      },
      {
        section: 'Operating',
        label: 'Approved expenses',
        amount: -round2(Number(expenses._sum.total ?? 0)),
      },
      {
        section: 'Operating',
        label: 'Sub-agent payouts',
        amount: -round2(Number(payouts._sum.amountPkr ?? 0)),
      },
      {
        section: 'Operating',
        label: 'Payroll net pay',
        amount: -payrollOut,
      },
      { section: 'Net', label: 'Net cash movement', amount: net },
    ];

    return {
      columns: [
        { key: 'section', header: 'Section' },
        { key: 'label', header: 'Description' },
        { key: 'amount', header: 'Amount (PKR)' },
      ],
      rows,
      totals: { operatingIn, operatingOut, net },
    };
  }

  private async trialBalance(scope: RequestBranchScope, query: ReportQuery) {
    const tb = await this.gl.trialBalance(scope, query.from, query.to);
    return {
      columns: [
        { key: 'code', header: 'Code' },
        { key: 'name', header: 'Account' },
        { key: 'type', header: 'Type' },
        { key: 'periodDebit', header: 'Period Debit' },
        { key: 'periodCredit', header: 'Period Credit' },
        { key: 'balanceDebit', header: 'Balance Debit' },
        { key: 'balanceCredit', header: 'Balance Credit' },
      ],
      rows: tb.rows as unknown as ReportRow[],
      totals: {
        totalDebit: tb.totalDebit,
        totalCredit: tb.totalCredit,
        balanced: tb.balanced ? 1 : 0,
      },
    };
  }

  private async cashBook(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const cashGl = await this.prisma.glAccount.findUnique({
      where: { tenantId_code: { tenantId: currentTenantId(), code: '1110' } },
    });
    if (!cashGl) {
      return {
        columns: [
          { key: 'date', header: 'Date' },
          { key: 'entryNo', header: 'Entry' },
          { key: 'description', header: 'Description' },
          { key: 'debit', header: 'Debit' },
          { key: 'credit', header: 'Credit' },
        ],
        rows: [],
      };
    }
    const lines = await this.prisma.journalLine.findMany({
      where: {
        glAccountId: cashGl.id,
        journalEntry: {
          approvalStatus: ApprovalStatus.Approved,
          ...(branchId ? { branchId } : {}),
          ...(Object.keys(dateFilter).length
            ? { entryDate: dateFilter }
            : {}),
        },
      },
      include: {
        journalEntry: {
          select: {
            entryNo: true,
            entryDate: true,
            description: true,
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNo: 'asc' } },
      ],
    });

    let running = 0;
    const rows: ReportRow[] = lines.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      running = round2(running + debit - credit);
      return {
        date: l.journalEntry.entryDate.toISOString().slice(0, 10),
        entryNo: l.journalEntry.entryNo,
        branchName: l.journalEntry.branch.name,
        description: l.journalEntry.description,
        debit,
        credit,
        balance: running,
      };
    });

    return {
      columns: [
        { key: 'date', header: 'Date' },
        { key: 'entryNo', header: 'Entry' },
        { key: 'branchName', header: 'Branch' },
        { key: 'description', header: 'Description' },
        { key: 'debit', header: 'Debit' },
        { key: 'credit', header: 'Credit' },
        { key: 'balance', header: 'Balance' },
      ],
      rows,
      totals: { closingBalance: running, lineCount: rows.length },
    };
  }

  private async bankBook(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const txns = await this.prisma.bankTransaction.findMany({
      where: {
        ...(branchId ? { bankAccount: { branchId } } : {}),
        ...(Object.keys(dateFilter).length ? { txnDate: dateFilter } : {}),
      },
      include: {
        bankAccount: {
          select: {
            name: true,
            bankName: true,
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { txnDate: 'desc' },
      take: 2000,
    });

    const rows: ReportRow[] = txns.map((t) => ({
      id: t.id,
      date: t.txnDate.toISOString().slice(0, 10),
      branchName: t.bankAccount.branch.name,
      account: t.bankAccount.name,
      bank: t.bankAccount.bankName,
      type: t.txnType,
      amount: Number(t.amount),
      signedAmount:
        t.txnType === 'deposit' ? Number(t.amount) : -Number(t.amount),
      reference: t.sourceType ?? '—',
      description: t.description,
    }));

    return {
      columns: [
        { key: 'date', header: 'Date' },
        { key: 'branchName', header: 'Branch' },
        { key: 'account', header: 'Account' },
        { key: 'type', header: 'Type' },
        { key: 'amount', header: 'Amount' },
        { key: 'reference', header: 'Reference' },
        { key: 'description', header: 'Description' },
      ],
      rows,
      totals: {
        deposits: round2(
          rows
            .filter((r) => r.type === 'deposit')
            .reduce((s, r) => s + Number(r.amount), 0),
        ),
        withdrawals: round2(
          rows
            .filter((r) => r.type !== 'deposit')
            .reduce((s, r) => s + Number(r.amount), 0),
        ),
      },
    };
  }

  private async journalRegister(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { entryDate: dateFilter }
          : {}),
      },
      include: {
        branch: { select: { name: true } },
        lines: { select: { debit: true, credit: true } },
      },
      orderBy: [{ entryDate: 'desc' }, { entryNo: 'desc' }],
      take: 2000,
    });

    const rows: ReportRow[] = entries.map((e) => ({
      id: e.id,
      entryNo: e.entryNo,
      date: e.entryDate.toISOString().slice(0, 10),
      branchName: e.branch.name,
      description: e.description,
      sourceType: e.sourceType,
      approvalStatus: e.approvalStatus,
      debit: round2(e.lines.reduce((s, l) => s + Number(l.debit), 0)),
      credit: round2(e.lines.reduce((s, l) => s + Number(l.credit), 0)),
      isAutoPosted: e.isAutoPosted,
    }));

    return {
      columns: [
        { key: 'entryNo', header: 'Entry No' },
        { key: 'date', header: 'Date' },
        { key: 'branchName', header: 'Branch' },
        { key: 'description', header: 'Description' },
        { key: 'sourceType', header: 'Source' },
        { key: 'approvalStatus', header: 'Status' },
        { key: 'debit', header: 'Debit' },
        { key: 'credit', header: 'Credit' },
      ],
      rows,
      totals: { entryCount: rows.length },
    };
  }

  private async expenseReport(scope: RequestBranchScope, query: ReportQuery) {
    const data = await this.branchExpenses(scope, query);
    return {
      columns: data.details!.columns,
      rows: data.details!.rows,
      totals: data.totals,
    };
  }

  private async incomeReport(scope: RequestBranchScope, query: ReportQuery) {
    const data = await this.branchIncome(scope, query);
    return {
      columns: data.details!.columns,
      rows: data.details!.rows,
      totals: data.totals,
    };
  }

  private async receivableAgeing(scope: RequestBranchScope) {
    const branchId = this.branchId(scope);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { notIn: [InvoiceStatus.Draft, InvoiceStatus.Closed] },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        branch: { select: { name: true } },
        university: { select: { name: true } },
        lines: { select: { commissionAmount: true } },
        receivables: { select: { amountPkrGross: true } },
        allocations: { select: { allocatedAmountPkr: true } },
      },
    });

    const now = Date.now();
    const buckets = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    const details: ReportRow[] = [];

    for (const inv of invoices) {
      const earned = await this.invoiceEarnedPkr(inv);
      const paid = round2(
        inv.receivables.reduce((s, r) => s + Number(r.amountPkrGross), 0) +
          inv.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0),
      );
      const outstanding = round2(Math.max(0, earned - paid));
      if (outstanding <= 0) continue;
      const days = Math.floor(
        (now - inv.invoiceDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      let bucket: keyof typeof buckets = '90+';
      if (days <= 30) bucket = '0-30';
      else if (days <= 60) bucket = '31-60';
      else if (days <= 90) bucket = '61-90';
      buckets[bucket] = round2(buckets[bucket] + outstanding);
      details.push({
        invoiceNo: inv.invoiceNo,
        date: inv.invoiceDate.toISOString().slice(0, 10),
        branchName: inv.branch.name,
        university: inv.university?.name ?? '—',
        outstanding,
        days,
        bucket,
      });
    }

    const rows: ReportRow[] = Object.entries(buckets).map(([name, value]) => ({
      name,
      value,
    }));

    return {
      columns: [
        { key: 'name', header: 'Age Bucket' },
        { key: 'value', header: 'Outstanding (PKR)' },
      ],
      rows,
      details: {
        columns: [
          { key: 'invoiceNo', header: 'Invoice' },
          { key: 'date', header: 'Date' },
          { key: 'branchName', header: 'Branch' },
          { key: 'university', header: 'University' },
          { key: 'outstanding', header: 'Outstanding' },
          { key: 'days', header: 'Days' },
          { key: 'bucket', header: 'Bucket' },
        ],
        rows: details,
      },
      totals: {
        total: round2(Object.values(buckets).reduce((s, v) => s + v, 0)),
      },
    };
  }

  private async payableAgeing(scope: RequestBranchScope) {
    const branchId = this.branchId(scope);
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
        branch: { select: { name: true } },
        subAgent: { select: { name: true, subAgentNo: true } },
        student: { select: { fullName: true, studentCode: true } },
        invoice: { select: { invoiceDate: true, invoiceNo: true } },
        payments: { select: { amountPkr: true } },
      },
    });

    const now = Date.now();
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const details: ReportRow[] = [];

    for (const c of commissions) {
      const paid = c.payments.reduce((s, p) => s + Number(p.amountPkr), 0);
      const outstanding = round2(Math.max(0, Number(c.payablePkrNet) - paid));
      if (outstanding <= 0) continue;
      const days = Math.floor(
        (now - c.invoice.invoiceDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      let bucket: keyof typeof buckets = '90+';
      if (days <= 30) bucket = '0-30';
      else if (days <= 60) bucket = '31-60';
      else if (days <= 90) bucket = '61-90';
      buckets[bucket] = round2(buckets[bucket] + outstanding);
      details.push({
        commissionNo: c.commissionNo,
        invoiceNo: c.invoice.invoiceNo,
        date: c.invoice.invoiceDate.toISOString().slice(0, 10),
        branchName: c.branch.name,
        subAgent: `${c.subAgent.subAgentNo} — ${c.subAgent.name}`,
        student: `${c.student.studentCode} — ${c.student.fullName}`,
        outstanding,
        days,
        bucket,
      });
    }

    const rows: ReportRow[] = Object.entries(buckets).map(([name, value]) => ({
      name,
      value,
    }));

    return {
      columns: [
        { key: 'name', header: 'Age Bucket' },
        { key: 'value', header: 'Outstanding (PKR)' },
      ],
      rows,
      details: {
        columns: [
          { key: 'commissionNo', header: 'Commission ID' },
          { key: 'invoiceNo', header: 'Invoice' },
          { key: 'date', header: 'Date' },
          { key: 'branchName', header: 'Branch' },
          { key: 'subAgent', header: 'Sub-Agent' },
          { key: 'student', header: 'Student' },
          { key: 'outstanding', header: 'Outstanding' },
          { key: 'days', header: 'Days' },
          { key: 'bucket', header: 'Bucket' },
        ],
        rows: details,
      },
      totals: {
        total: round2(Object.values(buckets).reduce((s, v) => s + v, 0)),
      },
    };
  }

  private async pettyCashReport(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const entries = await this.prisma.pettyCashEntry.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { entryDate: dateFilter }
          : {}),
      },
      include: {
        branch: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: { entryDate: 'desc' },
    });

    const rows: ReportRow[] = entries.map((e) => ({
      id: e.id,
      pettyCashNo: e.pettyCashNo,
      date: e.entryDate.toISOString().slice(0, 10),
      branchName: e.branch.name,
      category: e.category.name,
      description: e.description,
      type: e.entryType,
      total: Number(e.total),
      signed: e.entryType === 'in' ? Number(e.total) : -Number(e.total),
    }));

    return {
      columns: [
        { key: 'pettyCashNo', header: 'Entry ID' },
        { key: 'date', header: 'Date' },
        { key: 'branchName', header: 'Branch' },
        { key: 'category', header: 'Category' },
        { key: 'description', header: 'Description' },
        { key: 'type', header: 'Type' },
        { key: 'total', header: 'Total' },
      ],
      rows,
      totals: {
        in: round2(
          rows
            .filter((r) => r.type === 'in')
            .reduce((s, r) => s + Number(r.total), 0),
        ),
        out: round2(
          rows
            .filter((r) => r.type !== 'in')
            .reduce((s, r) => s + Number(r.total), 0),
        ),
      },
    };
  }

  private async taxSlice(
    scope: RequestBranchScope,
    query: ReportQuery,
    types: TaxType[],
  ) {
    const period =
      query.period ??
      this.periodBounds().period;
    const summary = await this.tax.summary(scope, period);
    const records = (summary.records as Array<{
      taxType: TaxType;
      type: string;
      period: string;
      periodLabel: string;
      amount: number;
      branchId: string;
      source: string;
    }>).filter((r) => types.includes(r.taxType));

    const branches = await this.prisma.branch.findMany({
      select: { id: true, name: true },
    });
    const nameById = new Map(branches.map((b) => [b.id, b.name]));

    const rows: ReportRow[] = records.map((r) => ({
      taxType: r.taxType,
      type: r.type,
      period: r.periodLabel,
      branchName: nameById.get(r.branchId) ?? r.branchId,
      amount: r.amount,
      source: r.source,
    }));

    return {
      columns: [
        { key: 'type', header: 'Tax Type' },
        { key: 'period', header: 'Period' },
        { key: 'branchName', header: 'Branch' },
        { key: 'amount', header: 'Amount (PKR)' },
        { key: 'source', header: 'Source' },
      ],
      rows,
      totals: {
        amount: round2(rows.reduce((s, r) => s + Number(r.amount), 0)),
      },
    };
  }

  private async commissionTracking(
    scope: RequestBranchScope,
    query: ReportQuery,
  ) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.Draft },
        ...(branchId ? { branchId } : {}),
        ...(query.universityId ? { universityId: query.universityId } : {}),
        ...(Object.keys(dateFilter).length
          ? { invoiceDate: dateFilter }
          : {}),
      },
      include: {
        university: { select: { name: true, countryName: true } },
        lines: { select: { commissionAmount: true } },
        receivables: { select: { amountPkrGross: true } },
        allocations: { select: { allocatedAmountPkr: true } },
      },
    });

    const byUni = new Map<
      string,
      {
        university: string;
        country: string;
        earnedPKR: number;
        receivedPKR: number;
        outstanding: number;
        invoiceCount: number;
      }
    >();

    for (const inv of invoices) {
      const key = inv.university?.name ?? 'Unassigned';
      const earned = await this.invoiceEarnedPkr(inv);
      const received = round2(
        inv.receivables.reduce((s, r) => s + Number(r.amountPkrGross), 0) +
          inv.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0),
      );
      const row = byUni.get(key) ?? {
        university: key,
        country: inv.university?.countryName ?? '—',
        earnedPKR: 0,
        receivedPKR: 0,
        outstanding: 0,
        invoiceCount: 0,
      };
      row.earnedPKR = round2(row.earnedPKR + earned);
      row.receivedPKR = round2(row.receivedPKR + received);
      row.outstanding = round2(row.earnedPKR - row.receivedPKR);
      row.invoiceCount += 1;
      byUni.set(key, row);
    }

    const rows = [...byUni.values()].sort((a, b) => b.earnedPKR - a.earnedPKR);
    return {
      columns: [
        { key: 'university', header: 'University' },
        { key: 'country', header: 'Country' },
        { key: 'invoiceCount', header: 'Invoices' },
        { key: 'earnedPKR', header: 'Earned' },
        { key: 'receivedPKR', header: 'Received' },
        { key: 'outstanding', header: 'Outstanding' },
      ],
      rows,
      totals: {
        earnedPKR: round2(rows.reduce((s, r) => s + r.earnedPKR, 0)),
        receivedPKR: round2(rows.reduce((s, r) => s + r.receivedPKR, 0)),
        outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      },
    };
  }

  private async subagentPayout(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const commissions = await this.prisma.subAgentCommission.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(this.dateRange(query.from, query.to)).length
          ? { invoice: { invoiceDate: this.dateRange(query.from, query.to) } }
          : {}),
      },
      include: {
        subAgent: { select: { name: true } },
        branch: { select: { name: true } },
        payments: { select: { amountPkr: true } },
      },
    });

    const byAgent = new Map<
      string,
      {
        subAgent: string;
        branchName: string;
        payableGross: number;
        payableNet: number;
        paid: number;
        outstanding: number;
        count: number;
      }
    >();

    for (const c of commissions) {
      const paid = round2(
        c.payments.reduce((s, p) => s + Number(p.amountPkr), 0),
      );
      const key = c.subAgentId;
      const row = byAgent.get(key) ?? {
        subAgent: c.subAgent.name,
        branchName: c.branch.name,
        payableGross: 0,
        payableNet: 0,
        paid: 0,
        outstanding: 0,
        count: 0,
      };
      row.payableGross = round2(row.payableGross + Number(c.payablePkrGross));
      row.payableNet = round2(row.payableNet + Number(c.payablePkrNet));
      row.paid = round2(row.paid + paid);
      row.outstanding = round2(row.payableNet - row.paid);
      row.count += 1;
      byAgent.set(key, row);
    }

    const rows = [...byAgent.values()].sort(
      (a, b) => b.payableNet - a.payableNet,
    );
    return {
      columns: [
        { key: 'subAgent', header: 'Sub-Agent' },
        { key: 'branchName', header: 'Branch' },
        { key: 'count', header: 'Commissions' },
        { key: 'payableGross', header: 'Gross Payable' },
        { key: 'payableNet', header: 'Net Payable' },
        { key: 'paid', header: 'Paid' },
        { key: 'outstanding', header: 'Outstanding' },
      ],
      rows,
      totals: {
        payableNet: round2(rows.reduce((s, r) => s + r.payableNet, 0)),
        paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
        outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      },
    };
  }

  private async netMargin(scope: RequestBranchScope, query: ReportQuery) {
    const branchId = this.branchId(scope);
    const dateFilter = this.dateRange(query.from, query.to);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.Draft },
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { invoiceDate: dateFilter }
          : {}),
      },
      include: {
        branch: { select: { name: true } },
        university: { select: { name: true, universityNo: true } },
        lines: {
          include: { student: { select: { id: true, fullName: true, studentCode: true } } },
        },
        commissions: { select: { studentId: true, payablePkrGross: true } },
      },
    });

    const rows: ReportRow[] = [];
    for (const inv of invoices) {
      const fx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : await this.fxToPkr(inv.currencyCode, inv.invoiceDate);
      for (const line of inv.lines) {
        const income = round2(Number(line.commissionAmount) * fx);
        const cost = round2(
          inv.commissions
            .filter((c) => c.studentId === line.studentId)
            .reduce((s, c) => s + Number(c.payablePkrGross), 0),
        );
        rows.push({
          invoiceNo: inv.invoiceNo,
          date: inv.invoiceDate.toISOString().slice(0, 10),
          branchName: inv.branch.name,
          studentCode: line.student.studentCode,
          student: line.student.fullName,
          universityNo: inv.university?.universityNo ?? '—',
          university: inv.university?.name ?? '—',
          incomePKR: income,
          subAgentCostPKR: cost,
          netMarginPKR: round2(income - cost),
        });
      }
    }

    return {
      columns: [
        { key: 'invoiceNo', header: 'Invoice' },
        { key: 'date', header: 'Date' },
        { key: 'branchName', header: 'Branch' },
        { key: 'studentCode', header: 'Student ID' },
        { key: 'student', header: 'Student' },
        { key: 'universityNo', header: 'University ID' },
        { key: 'university', header: 'University' },
        { key: 'incomePKR', header: 'Income' },
        { key: 'subAgentCostPKR', header: 'Sub-Agent Cost' },
        { key: 'netMarginPKR', header: 'Net Margin' },
      ],
      rows,
      totals: {
        incomePKR: round2(rows.reduce((s, r) => s + Number(r.incomePKR), 0)),
        subAgentCostPKR: round2(
          rows.reduce((s, r) => s + Number(r.subAgentCostPKR), 0),
        ),
        netMarginPKR: round2(
          rows.reduce((s, r) => s + Number(r.netMarginPKR), 0),
        ),
      },
    };
  }

  private async counsellorPl(
    user: AuthUserPayload,
    scope: RequestBranchScope,
    query: ReportQuery,
  ) {
    const branchId = this.branchId(scope);
    const isCounsellor = user.roleCode === ROLE_CODES.COUNSELLOR;
    const counsellorFilter =
      isCounsellor
        ? user.id
        : query.counsellorId && query.counsellorId !== 'all'
          ? query.counsellorId
          : undefined;

    const dateFilter = this.dateRange(query.from, query.to);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { not: InvoiceStatus.Draft },
        ...(branchId ? { branchId } : {}),
        ...(Object.keys(dateFilter).length
          ? { invoiceDate: dateFilter }
          : {}),
        lines: counsellorFilter
          ? { some: { student: { counsellorId: counsellorFilter } } }
          : undefined,
      },
      include: {
        branch: { select: { name: true } },
        university: { select: { name: true, countryName: true, universityNo: true } },
        lines: {
          include: {
            student: {
              select: {
                id: true,
                studentCode: true,
                fullName: true,
                country: true,
                counsellorId: true,
                counsellor: { select: { id: true, fullName: true } },
              },
            },
          },
        },
        receivables: { select: { amountPkrGross: true } },
        allocations: { select: { allocatedAmountPkr: true } },
        commissions: {
          select: { studentId: true, payablePkrGross: true, commissionNo: true },
        },
      },
    });

    const details: ReportRow[] = [];
    const byCounsellor = new Map<
      string,
      {
        id: string;
        name: string;
        branchId: string;
        branchName: string;
        invoiceCount: number;
        studentCount: number;
        incomePKR: number;
        costPKR: number;
        profitPKR: number;
        outstandingPKR: number;
        netProfitPKR: number;
        students: Set<string>;
      }
    >();

    for (const inv of invoices) {
      const fx =
        inv.exchangeRate != null
          ? Number(inv.exchangeRate)
          : await this.fxToPkr(inv.currencyCode, inv.invoiceDate);
      const receivedTotal = round2(
        inv.receivables.reduce((s, r) => s + Number(r.amountPkrGross), 0) +
          inv.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0),
      );
      const earnedTotal = round2(
        inv.lines.reduce((s, l) => s + Number(l.commissionAmount) * fx, 0),
      );

      for (const line of inv.lines) {
        if (
          counsellorFilter &&
          line.student.counsellorId !== counsellorFilter
        ) {
          continue;
        }
        const incomePKR = round2(Number(line.commissionAmount) * fx);
        const costPKR = round2(
          inv.commissions
            .filter((c) => c.studentId === line.student.id)
            .reduce((s, c) => s + Number(c.payablePkrGross), 0),
        );
        const share =
          earnedTotal > 0 ? incomePKR / earnedTotal : 1 / Math.max(inv.lines.length, 1);
        const received = round2(receivedTotal * share);
        const outstanding = round2(Math.max(0, incomePKR - received));
        const profitPKR = round2(incomePKR - costPKR);
        const netProfitPKR = round2(profitPKR - outstanding);

        details.push({
          id: `${inv.id}-${line.student.id}`,
          invoiceNo: inv.invoiceNo,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          branchId: inv.branchId,
          branchName: inv.branch.name,
          counsellorId: line.student.counsellorId,
          counsellorName: line.student.counsellor.fullName,
          studentId: line.student.id,
          studentCode: line.student.studentCode,
          studentName: line.student.fullName,
          universityNo: inv.university?.universityNo ?? '—',
          university: inv.university?.name ?? '—',
          country: line.student.country,
          currency: inv.currencyCode,
          commission: Number(line.commissionAmount),
          incomePKR,
          costPKR,
          profitPKR,
          received,
          outstanding,
          netProfitPKR,
          status: inv.status,
        });

        const cid = line.student.counsellorId;
        const agg = byCounsellor.get(cid) ?? {
          id: cid,
          name: line.student.counsellor.fullName,
          branchId: inv.branchId,
          branchName: inv.branch.name,
          invoiceCount: 0,
          studentCount: 0,
          incomePKR: 0,
          costPKR: 0,
          profitPKR: 0,
          outstandingPKR: 0,
          netProfitPKR: 0,
          students: new Set<string>(),
        };
        agg.incomePKR = round2(agg.incomePKR + incomePKR);
        agg.costPKR = round2(agg.costPKR + costPKR);
        agg.outstandingPKR = round2(agg.outstandingPKR + outstanding);
        agg.profitPKR = round2(agg.incomePKR - agg.costPKR);
        agg.netProfitPKR = round2(agg.profitPKR - agg.outstandingPKR);
        agg.students.add(line.student.id);
        agg.studentCount = agg.students.size;
        byCounsellor.set(cid, agg);
      }
    }

    // invoice counts per counsellor
    for (const d of details) {
      const agg = byCounsellor.get(String(d.counsellorId));
      if (agg) {
        /* counted via unique invoices below */
      }
    }
    const invPerCounsellor = new Map<string, Set<string>>();
    for (const d of details) {
      const set = invPerCounsellor.get(String(d.counsellorId)) ?? new Set();
      set.add(String(d.invoiceNo));
      invPerCounsellor.set(String(d.counsellorId), set);
    }

    const rows: ReportRow[] = [...byCounsellor.values()]
      .map((a) => ({
        id: a.id,
        name: a.name,
        branchId: a.branchId,
        branchName: a.branchName,
        invoiceCount: invPerCounsellor.get(a.id)?.size ?? 0,
        studentCount: a.studentCount,
        incomePKR: a.incomePKR,
        costPKR: a.costPKR,
        profitPKR: a.profitPKR,
        outstandingPKR: a.outstandingPKR,
        netProfitPKR: a.netProfitPKR,
        marginPct:
          a.incomePKR > 0
            ? round2((a.netProfitPKR / a.incomePKR) * 100)
            : 0,
      }))
      .sort((a, b) => Number(b.netProfitPKR) - Number(a.netProfitPKR));

    return {
      columns: [
        { key: 'name', header: 'Counsellor' },
        { key: 'branchName', header: 'Branch' },
        { key: 'invoiceCount', header: 'Invoices' },
        { key: 'studentCount', header: 'Students' },
        { key: 'incomePKR', header: 'Income' },
        { key: 'costPKR', header: 'Cost' },
        { key: 'profitPKR', header: 'Profit' },
        { key: 'outstandingPKR', header: 'Outstanding' },
        { key: 'netProfitPKR', header: 'Net Profit' },
        { key: 'marginPct', header: 'Margin %' },
      ],
      rows,
      details: {
        columns: [
          { key: 'invoiceNo', header: 'Invoice' },
          { key: 'invoiceDate', header: 'Date' },
          { key: 'counsellorName', header: 'Counsellor' },
          { key: 'studentCode', header: 'Student ID' },
          { key: 'studentName', header: 'Student' },
          { key: 'universityNo', header: 'University ID' },
          { key: 'university', header: 'University' },
          { key: 'incomePKR', header: 'Income' },
          { key: 'costPKR', header: 'Cost' },
          { key: 'outstanding', header: 'Outstanding' },
          { key: 'netProfitPKR', header: 'Net Profit' },
        ],
        rows: details,
      },
      totals: {
        incomePKR: round2(rows.reduce((s, r) => s + Number(r.incomePKR), 0)),
        costPKR: round2(rows.reduce((s, r) => s + Number(r.costPKR), 0)),
        netProfitPKR: round2(
          rows.reduce((s, r) => s + Number(r.netProfitPKR), 0),
        ),
      },
    };
  }

  private async destinationPipeline(
    user: AuthUserPayload,
    scope: RequestBranchScope,
    query: ReportQuery,
    mode: 'country' | 'university',
  ) {
    const branchId = this.branchId(scope);
    const isCounsellor = user.roleCode === ROLE_CODES.COUNSELLOR;
    const students = await this.prisma.student.findMany({
      where: {
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        ...(isCounsellor ? { counsellorId: user.id } : {}),
        ...(query.country ? { country: query.country } : {}),
        ...(query.universityId ? { universityId: query.universityId } : {}),
      },
      include: {
        university: { select: { name: true, countryName: true } },
        branch: { select: { name: true } },
      },
    });

    const groups = new Map<string, typeof students>();
    for (const s of students) {
      const key =
        mode === 'country'
          ? s.country || s.university.countryName || 'Unknown'
          : s.university.name;
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }

    const count = (rows: typeof students, status: ApplicationStatus) =>
      rows.filter((s) => s.applicationStatus === status).length;

    const rows: ReportRow[] = [...groups.entries()]
      .map(([label, list]) => {
        const total = list.length;
        const enrolled = count(list, ApplicationStatus.Enrolled);
        return {
          key: label,
          label,
          country:
            mode === 'university'
              ? list[0]?.university.countryName ?? '—'
              : label,
          total,
          applied: count(list, ApplicationStatus.Applied),
          offer: count(list, ApplicationStatus.Offer),
          visa: count(list, ApplicationStatus.Visa),
          enrolled,
          deferred: count(list, ApplicationStatus.Deferred),
          withdrawn: count(list, ApplicationStatus.Withdrawn),
          conversionRate: total ? round2((enrolled / total) * 100) : 0,
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));

    return {
      columns: [
        { key: 'label', header: mode === 'country' ? 'Country' : 'University' },
        ...(mode === 'university'
          ? [{ key: 'country', header: 'Country' }]
          : []),
        { key: 'total', header: 'Total' },
        { key: 'applied', header: 'Applied' },
        { key: 'offer', header: 'Offer' },
        { key: 'visa', header: 'Visa' },
        { key: 'enrolled', header: 'Enrolled' },
        { key: 'deferred', header: 'Deferred' },
        { key: 'withdrawn', header: 'Withdrawn' },
        { key: 'conversionRate', header: 'Conversion %' },
      ],
      rows,
      totals: {
        total: rows.reduce((s, r) => s + Number(r.total), 0),
        enrolled: rows.reduce((s, r) => s + Number(r.enrolled), 0),
      },
    };
  }
}
