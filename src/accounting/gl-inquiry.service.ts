import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from './gl-posting.service';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { currentTenantId } from '../common/tenant-scope';

export type CoaNode = {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
  isPostable: boolean;
  children?: CoaNode[];
};

@Injectable()
export class GlInquiryService {
  constructor(private readonly prisma: PrismaService) {}

  private branchFilter(scope: RequestBranchScope): Prisma.JournalEntryWhereInput {
    return scope.allBranches ? {} : { branchId: scope.branchId! };
  }

  /** Only approved (incl. auto-posted) journals affect balances. */
  private postedWhere(
    scope: RequestBranchScope,
    from?: string,
    to?: string,
  ): Prisma.JournalEntryWhereInput {
    return {
      ...this.branchFilter(scope),
      approvalStatus: ApprovalStatus.Approved,
      ...(from || to
        ? {
            entryDate: {
              ...(from ? { gte: new Date(from.slice(0, 10)) } : {}),
              ...(to ? { lte: new Date(to.slice(0, 10)) } : {}),
            },
          }
        : {}),
    };
  }

  async trialBalance(scope: RequestBranchScope, from?: string, to?: string) {
    const lines = await this.prisma.journalLine.findMany({
      where: { journalEntry: this.postedWhere(scope, from, to) },
      include: {
        glAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            accountType: true,
            isPostable: true,
          },
        },
      },
    });

    const byCode = new Map<
      string,
      {
        code: string;
        name: string;
        type: string;
        debit: number;
        credit: number;
      }
    >();

    for (const l of lines) {
      const code = l.glAccount.code;
      const row = byCode.get(code) ?? {
        code,
        name: l.glAccount.name,
        type: l.glAccount.accountType,
        debit: 0,
        credit: 0,
      };
      row.debit = round2(row.debit + Number(l.debit));
      row.credit = round2(row.credit + Number(l.credit));
      byCode.set(code, row);
    }

    const rows = [...byCode.values()]
      .map((r) => {
        const isDebitNormal = r.type === 'asset' || r.type === 'expense';
        const signed = isDebitNormal
          ? round2(r.debit - r.credit)
          : round2(r.credit - r.debit);
        return {
          code: r.code,
          name: r.name,
          type: r.type,
          periodDebit: r.debit,
          periodCredit: r.credit,
          balanceDebit:
            isDebitNormal && signed > 0
              ? signed
              : !isDebitNormal && signed < 0
                ? Math.abs(signed)
                : 0,
          balanceCredit:
            !isDebitNormal && signed > 0
              ? signed
              : isDebitNormal && signed < 0
                ? Math.abs(signed)
                : 0,
        };
      })
      .filter((r) => r.periodDebit > 0 || r.periodCredit > 0)
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = round2(rows.reduce((s, r) => s + r.balanceDebit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.balanceCredit, 0));

    return {
      rows,
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) < 0.02,
      from: from ?? null,
      to: to ?? null,
    };
  }

  async accountActivity(
    accountCode: string,
    scope: RequestBranchScope,
    from?: string,
    to?: string,
  ) {
    const account = await this.prisma.glAccount.findUnique({
      where: {
        tenantId_code: { tenantId: currentTenantId(), code: accountCode },
      },
    });
    if (!account) throw new NotFoundException('GL account not found');

    const lines = await this.prisma.journalLine.findMany({
      where: {
        glAccountId: account.id,
        journalEntry: this.postedWhere(scope, from, to),
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNo: true,
            entryDate: true,
            description: true,
            sourceType: true,
            sourceId: true,
            branchId: true,
            isAutoPosted: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNo: 'asc' } },
        { lineNo: 'asc' },
      ],
    });

    let running = 0;
    const isDebitNormal =
      account.accountType === 'asset' || account.accountType === 'expense';
    const entries = lines.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      running = round2(
        running + (isDebitNormal ? debit - credit : credit - debit),
      );
      return {
        journalEntryId: l.journalEntry.id,
        entryNo: l.journalEntry.entryNo,
        date: l.journalEntry.entryDate.toISOString().slice(0, 10),
        description: l.journalEntry.description,
        sourceType: l.journalEntry.sourceType,
        debit,
        credit,
        balance: running,
        memo: l.memo,
      };
    });

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
      },
      entries,
      closingBalance: running,
    };
  }

  /** COA tree with balances from posted lines. */
  async chartWithBalances(scope: RequestBranchScope): Promise<CoaNode[]> {
    const accounts = await this.prisma.glAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    const lines = await this.prisma.journalLine.findMany({
      where: { journalEntry: this.postedWhere(scope) },
      select: {
        glAccountId: true,
        debit: true,
        credit: true,
        glAccount: { select: { accountType: true } },
      },
    });

    const bal = new Map<string, number>();
    for (const l of lines) {
      const type = l.glAccount.accountType;
      const isDebitNormal = type === 'asset' || type === 'expense';
      const delta = isDebitNormal
        ? Number(l.debit) - Number(l.credit)
        : Number(l.credit) - Number(l.debit);
      bal.set(l.glAccountId, round2((bal.get(l.glAccountId) ?? 0) + delta));
    }

    const byId = new Map<string, CoaNode>();
    for (const a of accounts) {
      byId.set(a.id, {
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.accountType,
        balance: bal.get(a.id) ?? 0,
        isPostable: a.isPostable,
        children: [],
      });
    }

    const roots: CoaNode[] = [];
    for (const a of accounts) {
      const node = byId.get(a.id)!;
      if (a.parentId && byId.has(a.parentId)) {
        byId.get(a.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    const rollup = (n: CoaNode): number => {
      if (!n.children?.length) return n.balance;
      n.balance = round2(n.children.reduce((s, c) => s + rollup(c), 0));
      return n.balance;
    };
    roots.forEach(rollup);

    return roots;
  }
}
