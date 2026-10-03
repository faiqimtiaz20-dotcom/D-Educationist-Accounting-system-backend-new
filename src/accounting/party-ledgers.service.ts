import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from './gl-posting.service';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';

function lineCommission(line: {
  tuitionFee: unknown;
  scholarship: unknown;
  commissionRate: unknown;
  bonus: unknown;
}) {
  const net = Number(line.tuitionFee) - Number(line.scholarship);
  return round2(net * (Number(line.commissionRate) / 100) + Number(line.bonus));
}

@Injectable()
export class PartyLedgersService {
  constructor(private readonly prisma: PrismaService) {}

  async studentLedger(studentId: string, scope: RequestBranchScope) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        deletedAt: null,
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
        lines: { some: { studentId } },
      },
      include: {
        lines: true,
        receivables: {
          select: {
            id: true,
            receiptNo: true,
            receiptDate: true,
            amountReceived: true,
            isPartial: true,
          },
        },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    type Entry = {
      date: string;
      type: string;
      ref: string;
      debit: number;
      credit: number;
      description: string;
    };
    const entries: Entry[] = [];

    for (const inv of invoices) {
      const line = inv.lines.find((l) => l.studentId === studentId);
      if (!line) continue;
      const commission = lineCommission(line);
      const invTotal = round2(
        inv.lines.reduce((s, l) => s + lineCommission(l), 0),
      );
      const share = invTotal > 0 ? commission / invTotal : 0;

      entries.push({
        date: inv.invoiceDate.toISOString().slice(0, 10),
        type: 'invoice',
        ref: inv.invoiceNo,
        debit: commission,
        credit: 0,
        description: `Invoice ${inv.invoiceNo}`,
      });

      for (const rec of inv.receivables) {
        entries.push({
          date: rec.receiptDate.toISOString().slice(0, 10),
          type: 'receipt',
          ref: rec.receiptNo,
          debit: 0,
          credit: round2(Number(rec.amountReceived) * share),
          description: `Payment ${rec.receiptNo}${rec.isPartial ? ' (partial)' : ''}`,
        });
      }
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    const withBalance = entries.map((e) => {
      balance = round2(balance + e.debit - e.credit);
      return { ...e, balance };
    });

    return {
      partyType: 'student' as const,
      partyId: studentId,
      partyName: student.fullName,
      partyCode: student.studentCode,
      currencyCode: student.currencyCode,
      totalDebit: round2(entries.reduce((s, e) => s + e.debit, 0)),
      totalCredit: round2(entries.reduce((s, e) => s + e.credit, 0)),
      outstanding: balance,
      entries: withBalance,
    };
  }

  async vendorLedger(vendorKey: string, scope: RequestBranchScope) {
    // vendorKey may be UUID or vendor name
    const vendor = await this.prisma.vendor.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: vendorKey }, { name: vendorKey }],
      },
    });

    const expenses = await this.prisma.expense.findMany({
      where: {
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
        ...(vendor
          ? { OR: [{ vendorId: vendor.id }, { vendorName: vendor.name }] }
          : { vendorName: vendorKey }),
      },
      include: {
        category: { select: { name: true } },
      },
      orderBy: { expenseDate: 'asc' },
    });

    if (!vendor && expenses.length === 0) {
      throw new NotFoundException('Vendor not found');
    }

    const entries = expenses.map((e) => {
      const approved = e.approvalStatus === 'Approved';
      return {
        date: e.expenseDate.toISOString().slice(0, 10),
        type: 'expense',
        ref: e.id.slice(0, 8).toUpperCase(),
        debit: approved ? 0 : Number(e.total),
        credit: approved ? Number(e.total) : 0,
        description: `${e.category.name} — ${e.approvalStatus}`,
        approvalStatus: e.approvalStatus,
      };
    });

    // Also show approved as bill+payment? FE shows pending as debit, approved as credit (paid).
    // Align with FE: pending = bill outstanding (debit), approved = paid (credit).
    let balance = 0;
    const withBalance = entries.map((e) => {
      balance = round2(balance + e.debit - e.credit);
      return { ...e, balance };
    });

    const name = vendor?.name ?? vendorKey;
    const totalBills = round2(expenses.reduce((s, e) => s + Number(e.total), 0));
    const totalPaid = round2(
      expenses
        .filter((e) => e.approvalStatus === 'Approved')
        .reduce((s, e) => s + Number(e.total), 0),
    );

    return {
      partyType: 'vendor' as const,
      partyId: vendor?.id ?? null,
      partyName: name,
      totalBills,
      totalPaid,
      outstanding: balance,
      entries: withBalance,
    };
  }

  async subAgentLedger(subAgentId: string, scope: RequestBranchScope) {
    const agent = await this.prisma.subAgent.findFirst({
      where: { id: subAgentId, deletedAt: null },
    });
    if (!agent) throw new NotFoundException('Sub-agent not found');

    const commissions = await this.prisma.subAgentCommission.findMany({
      where: {
        subAgentId,
        ...(scope.allBranches ? {} : { branchId: scope.branchId! }),
      },
      include: {
        invoice: { select: { invoiceNo: true } },
        payments: {
          select: {
            id: true,
            amountPkr: true,
            paymentDate: true,
            chequeNo: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    type Entry = {
      date: string;
      type: string;
      ref: string;
      debit: number;
      credit: number;
      description: string;
    };
    const entries: Entry[] = [];

    for (const c of commissions) {
      entries.push({
        date: c.createdAt.toISOString().slice(0, 10),
        type: 'commission',
        ref: c.invoice.invoiceNo,
        debit: Number(c.payablePkrNet),
        credit: 0,
        description: `Commission payable (${c.status})`,
      });
      for (const p of c.payments) {
        entries.push({
          date: p.paymentDate.toISOString().slice(0, 10),
          type: 'payment',
          ref: p.chequeNo || p.id.slice(0, 8),
          debit: 0,
          credit: Number(p.amountPkr),
          description: `Payment — ${p.chequeNo || 'transfer'}`,
        });
      }
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    const withBalance = entries.map((e) => {
      balance = round2(balance + e.debit - e.credit);
      return { ...e, balance };
    });

    const totalPayable = round2(
      commissions.reduce((s, c) => s + Number(c.payablePkrNet), 0),
    );
    const totalPaid = round2(
      commissions.reduce(
        (s, c) =>
          s + c.payments.reduce((ps, p) => ps + Number(p.amountPkr), 0),
        0,
      ),
    );

    return {
      partyType: 'sub_agent' as const,
      partyId: subAgentId,
      partyName: agent.name,
      totalPayable,
      totalPaid,
      outstanding: balance,
      entries: withBalance,
    };
  }
}
