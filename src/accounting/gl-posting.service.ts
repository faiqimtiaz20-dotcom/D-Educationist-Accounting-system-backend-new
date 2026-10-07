import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  ApprovalStatus,
  GlAccountType,
  JournalSourceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentTenantId } from '../common/tenant-scope';

export const GL_CODES = {
  CASH: '1110',
  BANK: '1120',
  AR: '1200',
  WHT_RECEIVABLE: '1210',
  /** Liability clearing — coded in 2000 range (was mis-coded 1220 in early seeds). */
  REMITTANCE_CLEARING: '2400',
  INPUT_TAX: '1310',
  AP: '2100',
  TAX_PAYABLE: '2200',
  SALARY_PAYABLE: '2300',
  COMMISSION_INCOME: '4100',
  OTHER_INCOME: '4200',
  FX_GAIN: '4300',
  SUB_AGENT_COMMISSION: '5100',
  OPERATING_EXPENSE: '5200',
  PAYROLL: '5300',
  FX_LOSS: '5500',
} as const;

/** Minimal postable accounts created on demand if a tenant COA is incomplete. */
const RUNTIME_COA_FALLBACK: Record<
  string,
  { name: string; accountType: GlAccountType; sortOrder: number }
> = {
  '1110': { name: 'Cash in Hand', accountType: 'asset', sortOrder: 3 },
  '1120': { name: 'Bank Accounts', accountType: 'asset', sortOrder: 4 },
  '1200': { name: 'Accounts Receivable', accountType: 'asset', sortOrder: 5 },
  '1210': { name: 'WHT Receivable', accountType: 'asset', sortOrder: 6 },
  '1310': { name: 'Input Tax Credit', accountType: 'asset', sortOrder: 8 },
  '2100': { name: 'Accounts Payable', accountType: 'liability', sortOrder: 11 },
  '2200': { name: 'Tax Payable', accountType: 'liability', sortOrder: 12 },
  '2300': { name: 'Salary Payable', accountType: 'liability', sortOrder: 13 },
  '2400': {
    name: 'Unallocated Remittances',
    accountType: 'liability',
    sortOrder: 14,
  },
  '4100': { name: 'Commission Income', accountType: 'income', sortOrder: 31 },
  '4200': { name: 'Other Income', accountType: 'income', sortOrder: 32 },
  '4300': { name: 'FX Gain', accountType: 'income', sortOrder: 33 },
  '5100': {
    name: 'Sub-Agent Commission',
    accountType: 'expense',
    sortOrder: 41,
  },
  '5200': { name: 'Operating Expenses', accountType: 'expense', sortOrder: 42 },
  '5300': { name: 'Payroll', accountType: 'expense', sortOrder: 43 },
  '5500': { name: 'FX Loss', accountType: 'expense', sortOrder: 45 },
};

type Tx = Prisma.TransactionClient;

@Injectable()
export class GlPostingService {
  constructor(private readonly prisma: PrismaService) {}

  async getWhtRateFraction(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: {
        tenantId_key: {
          tenantId: currentTenantId(),
          key: 'wht_rate_percent',
        },
      },
    });
    const pct = typeof row?.value === 'number' ? row.value : 1;
    return pct / 100;
  }

  async getFxRateToPkr(currencyCode: string, asOf?: Date): Promise<number> {
    const code = currencyCode.toUpperCase();
    if (code === 'PKR') return 1;
    const rate = await this.prisma.fxRate.findFirst({
      where: {
        currencyCode: code,
        ...(asOf ? { effectiveDate: { lte: asOf } } : {}),
      },
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
    return defaults[code] ?? 1;
  }

  async alreadyPosted(
    sourceType: JournalSourceType,
    sourceId: string,
    tx: Tx = this.prisma,
  ) {
    // findFirst + tenantId avoids compound-unique quirks under the tenant extension
    const existing = await tx.journalEntry.findFirst({
      where: {
        sourceType,
        sourceId,
        tenantId: currentTenantId(),
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private async resolveAccountId(code: string, tx: Tx) {
    const tenantId = currentTenantId();
    let acc = await tx.glAccount.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    // Legacy remittance clearing was mis-coded as 1220 (asset block)
    if (!acc && code === GL_CODES.REMITTANCE_CLEARING) {
      acc = await tx.glAccount.findUnique({
        where: { tenantId_code: { tenantId, code: '1220' } },
      });
    }
    // Auto-heal incomplete tenant COA for postable leaf accounts we need at runtime
    if (!acc) {
      const seed = RUNTIME_COA_FALLBACK[code];
      if (seed) {
        acc = await tx.glAccount.upsert({
          where: { tenantId_code: { tenantId, code } },
          create: {
            tenantId,
            code,
            name: seed.name,
            accountType: seed.accountType,
            isPostable: true,
            isActive: true,
            sortOrder: seed.sortOrder,
          },
          update: { isActive: true, isPostable: true },
        });
      }
    }
    if (!acc) {
      throw new BadRequestException(
        `GL account ${code} missing — seed COA (M3) first`,
      );
    }
    return acc.id;
  }

  /** Public wrapper so journals service can allocate entry numbers. */
  async allocateEntryNo(tx: Tx = this.prisma) {
    return this.nextEntryNo(tx);
  }

  private async nextEntryNo(tx: Tx) {
    const year = new Date().getFullYear();
    const prefix = `JE-${year}-`;
    const rows = await tx.journalEntry.findMany({
      where: { entryNo: { startsWith: prefix } },
      select: { entryNo: true },
    });
    let next = 1;
    for (const row of rows) {
      const suffix = row.entryNo.slice(prefix.length);
      // Only count purely numeric suffixes (ignore seed labels like M7-PC01)
      if (/^\d+$/.test(suffix)) {
        const n = parseInt(suffix, 10);
        if (!Number.isNaN(n) && n >= next) next = n + 1;
      }
    }
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async postInvoiceAccrual(
    tx: Tx,
    input: {
      invoiceId: string;
      invoiceNo: string;
      branchId: string;
      entryDate: Date;
      amountPkr: number;
      actorId?: string;
    },
  ) {
    if (input.amountPkr <= 0) {
      throw new BadRequestException('Invoice accrual amount must be positive');
    }
    if (await this.alreadyPosted(JournalSourceType.Invoice, input.invoiceId, tx)) {
      return null;
    }

    const arId = await this.resolveAccountId(GL_CODES.AR, tx);
    const incomeId = await this.resolveAccountId(GL_CODES.COMMISSION_INCOME, tx);
    const entryNo = await this.nextEntryNo(tx);
    const amount = round2(input.amountPkr);

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Commission accrual — ${input.invoiceNo}`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.Invoice,
        sourceId: input.invoiceId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: {
          create: [
            { lineNo: 1, glAccountId: arId, debit: amount, credit: 0 },
            { lineNo: 2, glAccountId: incomeId, debit: 0, credit: amount },
          ],
        },
      },
      include: { lines: true },
    });
  }

  async postOtherInvoiceAccrual(
    tx: Tx,
    input: {
      otherInvoiceId: string;
      invoiceNo: string;
      branchId: string;
      entryDate: Date;
      amountPkr: number;
      actorId?: string;
    },
  ) {
    if (input.amountPkr <= 0) {
      throw new BadRequestException('Other invoice accrual amount must be positive');
    }
    if (
      await this.alreadyPosted(
        JournalSourceType.OtherInvoice,
        input.otherInvoiceId,
        tx,
      )
    ) {
      return null;
    }

    const arId = await this.resolveAccountId(GL_CODES.AR, tx);
    const incomeId = await this.resolveAccountId(GL_CODES.OTHER_INCOME, tx);
    const entryNo = await this.nextEntryNo(tx);
    const amount = round2(input.amountPkr);

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Other invoice accrual — ${input.invoiceNo}`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.OtherInvoice,
        sourceId: input.otherInvoiceId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: {
          create: [
            { lineNo: 1, glAccountId: arId, debit: amount, credit: 0 },
            { lineNo: 2, glAccountId: incomeId, debit: 0, credit: amount },
          ],
        },
      },
      include: { lines: true },
    });
  }

  async postReceivableReceipt(
    tx: Tx,
    input: {
      receivableId: string;
      receiptNo: string;
      branchId: string;
      entryDate: Date;
      invoiceNo?: string;
      grossPkr: number;
      whtPkr: number;
      netPkr: number;
      /** AR cleared at invoice FX; defaults to grossPkr (no FX difference). */
      arClearedPkr?: number;
      /** When true: settle from remittance clearing (no bank/WHT lines). */
      fromClearing?: boolean;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(
        JournalSourceType.Receivable,
        input.receivableId,
        tx,
      )
    ) {
      return null;
    }

    const gross = round2(input.grossPkr);
    const wht = round2(input.whtPkr);
    const net = round2(input.netPkr);
    const arCleared = round2(input.arClearedPkr ?? gross);
    const fxDiff = round2(gross - arCleared);
    if (Math.abs(net + wht - gross) > 0.02) {
      throw new BadRequestException('Receivable journal lines do not balance');
    }

    const arId = await this.resolveAccountId(GL_CODES.AR, tx);
    const entryNo = await this.nextEntryNo(tx);
    const invLabel = input.invoiceNo ?? 'unallocated';

    const lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }> = [];
    let lineNo = 1;

    if (input.fromClearing) {
      const clearingId = await this.resolveAccountId(
        GL_CODES.REMITTANCE_CLEARING,
        tx,
      );
      lines.push({
        lineNo: lineNo++,
        glAccountId: clearingId,
        debit: gross,
        credit: 0,
      });
    } else {
      const bankId = await this.resolveAccountId(GL_CODES.BANK, tx);
      lines.push({ lineNo: lineNo++, glAccountId: bankId, debit: net, credit: 0 });
      if (wht > 0) {
        const whtId = await this.resolveAccountId(GL_CODES.WHT_RECEIVABLE, tx);
        lines.push({
          lineNo: lineNo++,
          glAccountId: whtId,
          debit: wht,
          credit: 0,
        });
      }
    }

    if (fxDiff < -0.005) {
      const lossId = await this.resolveAccountId(GL_CODES.FX_LOSS, tx);
      lines.push({
        lineNo: lineNo++,
        glAccountId: lossId,
        debit: round2(-fxDiff),
        credit: 0,
      });
    }

    lines.push({
      lineNo: lineNo++,
      glAccountId: arId,
      debit: 0,
      credit: arCleared,
    });

    if (fxDiff > 0.005) {
      const gainId = await this.resolveAccountId(GL_CODES.FX_GAIN, tx);
      lines.push({
        lineNo: lineNo++,
        glAccountId: gainId,
        debit: 0,
        credit: fxDiff,
      });
    }

    this.assertLinesBalanced(lines, 'Receivable');

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `University receipt ${input.receiptNo} — ${invLabel}`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.Receivable,
        sourceId: input.receivableId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /** Bulk remittance landed in bank before invoice allocation. */
  async postBulkRemittance(
    tx: Tx,
    input: {
      receivableId: string;
      receiptNo: string;
      branchId: string;
      entryDate: Date;
      grossPkr: number;
      whtPkr: number;
      netPkr: number;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(
        JournalSourceType.BulkReceivable,
        input.receivableId,
        tx,
      )
    ) {
      return null;
    }
    const gross = round2(input.grossPkr);
    const wht = round2(input.whtPkr);
    const net = round2(input.netPkr);
    if (Math.abs(net + wht - gross) > 0.02) {
      throw new BadRequestException('Bulk remittance JE unbalanced');
    }

    const bankId = await this.resolveAccountId(GL_CODES.BANK, tx);
    const clearingId = await this.resolveAccountId(
      GL_CODES.REMITTANCE_CLEARING,
      tx,
    );
    const lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }> = [{ lineNo: 1, glAccountId: bankId, debit: net, credit: 0 }];
    let lineNo = 2;
    if (wht > 0) {
      const whtId = await this.resolveAccountId(GL_CODES.WHT_RECEIVABLE, tx);
      lines.push({ lineNo: lineNo++, glAccountId: whtId, debit: wht, credit: 0 });
    }
    lines.push({
      lineNo,
      glAccountId: clearingId,
      debit: 0,
      credit: gross,
    });
    this.assertLinesBalanced(lines, 'Bulk remittance');

    const entryNo = await this.nextEntryNo(tx);
    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Bulk remittance ${input.receiptNo} (unallocated)`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.BulkReceivable,
        sourceId: input.receivableId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /** Accrue sub-agent commission: Dr Exp / Cr AP + WHT Payable. */
  async postCommissionAccrual(
    tx: Tx,
    input: {
      commissionId: string;
      branchId: string;
      entryDate: Date;
      payablePkrGross: number;
      whtPkr: number;
      payablePkrNet: number;
      subAgentName: string;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(
        JournalSourceType.SubAgentCommission,
        input.commissionId,
        tx,
      )
    ) {
      return null;
    }
    const gross = round2(input.payablePkrGross);
    const wht = round2(input.whtPkr);
    const net = round2(input.payablePkrNet);
    if (Math.abs(net + wht - gross) > 0.02) {
      throw new BadRequestException('Commission accrual unbalanced');
    }

    const expId = await this.resolveAccountId(GL_CODES.SUB_AGENT_COMMISSION, tx);
    const apId = await this.resolveAccountId(GL_CODES.AP, tx);
    const lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }> = [{ lineNo: 1, glAccountId: expId, debit: gross, credit: 0 }];
    let lineNo = 2;
    if (wht > 0) {
      const taxId = await this.resolveAccountId(GL_CODES.TAX_PAYABLE, tx);
      lines.push({ lineNo: lineNo++, glAccountId: taxId, debit: 0, credit: wht });
    }
    lines.push({ lineNo, glAccountId: apId, debit: 0, credit: net });
    this.assertLinesBalanced(lines, 'Commission accrual');

    const entryNo = await this.nextEntryNo(tx);
    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Sub-agent commission accrual — ${input.subAgentName}`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.SubAgentCommission,
        sourceId: input.commissionId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /**
   * Sub-agent payout.
   * If commission was accrued: Dr AP / Cr Bank (WHT already booked).
   * Else legacy cash: Dr Exp / Cr Tax + Bank.
   */
  async postSubAgentPayment(
    tx: Tx,
    input: {
      paymentId: string;
      commissionId: string;
      branchId: string;
      entryDate: Date;
      amountPkrNet: number;
      whtPkrShare: number;
      subAgentName: string;
      chequeNo?: string | null;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(
        JournalSourceType.SubAgentPayment,
        input.paymentId,
        tx,
      )
    ) {
      return null;
    }

    const net = round2(input.amountPkrNet);
    const wht = round2(input.whtPkrShare);
    const gross = round2(net + wht);
    if (net <= 0) {
      throw new BadRequestException('Payment amount must be positive');
    }

    const bankId = await this.resolveAccountId(GL_CODES.BANK, tx);
    const entryNo = await this.nextEntryNo(tx);
    const cheque = input.chequeNo ? ` chq ${input.chequeNo}` : '';
    const accrued = await this.alreadyPosted(
      JournalSourceType.SubAgentCommission,
      input.commissionId,
      tx,
    );

    let lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }>;

    if (accrued) {
      const apId = await this.resolveAccountId(GL_CODES.AP, tx);
      lines = [
        { lineNo: 1, glAccountId: apId, debit: net, credit: 0 },
        { lineNo: 2, glAccountId: bankId, debit: 0, credit: net },
      ];
    } else if (wht > 0) {
      const expId = await this.resolveAccountId(
        GL_CODES.SUB_AGENT_COMMISSION,
        tx,
      );
      const taxId = await this.resolveAccountId(GL_CODES.TAX_PAYABLE, tx);
      lines = [
        { lineNo: 1, glAccountId: expId, debit: gross, credit: 0 },
        { lineNo: 2, glAccountId: taxId, debit: 0, credit: wht },
        { lineNo: 3, glAccountId: bankId, debit: 0, credit: net },
      ];
    } else {
      const expId = await this.resolveAccountId(
        GL_CODES.SUB_AGENT_COMMISSION,
        tx,
      );
      lines = [
        { lineNo: 1, glAccountId: expId, debit: net, credit: 0 },
        { lineNo: 2, glAccountId: bankId, debit: 0, credit: net },
      ];
    }
    this.assertLinesBalanced(lines, 'Sub-agent payment');

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Sub-agent payment — ${input.subAgentName}${cheque}`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.SubAgentPayment,
        sourceId: input.paymentId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /**
   * Reverse an auto-posted source journal (idempotent if already reversed).
   * Creates JournalSourceType.Reversal with sourceId = original JE id.
   */
  async reverseSourceJournal(
    tx: Tx,
    input: {
      sourceType: JournalSourceType;
      sourceId: string;
      reverseDate: Date;
      reason: string;
      actorId?: string;
    },
  ) {
    const original = await tx.journalEntry.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!original) return null;
    if (original.approvalStatus !== ApprovalStatus.Approved) {
      throw new BadRequestException(
        'Only approved journals can be reversed',
      );
    }

    const existing = await tx.journalEntry.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: JournalSourceType.Reversal,
          sourceId: original.id,
        },
      },
    });
    if (existing) return existing;

    const entryNo = await this.nextEntryNo(tx);
    const reversal = await tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.reverseDate,
        branchId: original.branchId,
        description: input.reason,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.Reversal,
        sourceId: original.id,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: {
          create: original.lines.map((l, i) => ({
            lineNo: i + 1,
            glAccountId: l.glAccountId,
            debit: l.credit,
            credit: l.debit,
            memo: `Reversal of ${original.entryNo} L${l.lineNo}`,
          })),
        },
      },
      include: { lines: true },
    });

    // Free source key so a corrected JE can be re-posted for the same document
    await tx.journalEntry.update({
      where: { id: original.id },
      data: { sourceType: null, sourceId: null },
    });

    return reversal;
  }

  private assertLinesBalanced(
    lines: Array<{ debit: number; credit: number }>,
    label: string,
  ) {
    const debit = round2(lines.reduce((s, l) => s + Number(l.debit), 0));
    const credit = round2(lines.reduce((s, l) => s + Number(l.credit), 0));
    if (Math.abs(debit - credit) > 0.01) {
      throw new BadRequestException(
        `${label} JE unbalanced: debit ${debit} ≠ credit ${credit}`,
      );
    }
  }

  /**
   * Approved expense payment (vendor WHT withheld from remittance).
   * Dr 5200 OpEx (principal) + Dr 1310 Input Tax (GST/SST/sales)
   * Cr 2200 Tax Payable (WHT) + Cr 1110/1120 Cash/Bank (principal + inputTax − WHT)
   */
  async postExpense(
    tx: Tx,
    input: {
      expenseId: string;
      branchId: string;
      entryDate: Date;
      principal: number;
      inputTax: number;
      whtPayable?: number;
      total: number;
      payFromCash: boolean;
      vendorLabel: string;
      categoryLabel: string;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(JournalSourceType.Expense, input.expenseId, tx)
    ) {
      return null;
    }

    const principal = round2(input.principal);
    const inputTax = round2(input.inputTax);
    const wht = round2(input.whtPayable ?? 0);
    const total = round2(input.total);
    // Cash to vendor = gross before WHT − WHT (= total − 2×wht when total includes WHT)
    const cashOut = round2(principal + inputTax - wht);
    if (total <= 0) {
      throw new BadRequestException('Expense total must be positive');
    }
    if (cashOut < -0.001) {
      throw new BadRequestException('WHT cannot exceed principal + input tax');
    }
    if (Math.abs(round2(principal + inputTax + wht) - total) > 0.01) {
      throw new BadRequestException(
        `Expense total ${total} must equal principal + input tax + WHT`,
      );
    }

    const opexId = await this.resolveAccountId(
      GL_CODES.OPERATING_EXPENSE,
      tx,
    );
    const creditId = await this.resolveAccountId(
      input.payFromCash ? GL_CODES.CASH : GL_CODES.BANK,
      tx,
    );
    const entryNo = await this.nextEntryNo(tx);

    const lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }> = [{ lineNo: 1, glAccountId: opexId, debit: principal, credit: 0 }];
    let lineNo = 2;
    if (inputTax > 0) {
      const taxId = await this.resolveAccountId(GL_CODES.INPUT_TAX, tx);
      lines.push({
        lineNo: lineNo++,
        glAccountId: taxId,
        debit: inputTax,
        credit: 0,
      });
    }
    if (wht > 0) {
      const whtId = await this.resolveAccountId(GL_CODES.TAX_PAYABLE, tx);
      lines.push({
        lineNo: lineNo++,
        glAccountId: whtId,
        debit: 0,
        credit: wht,
      });
    }
    lines.push({
      lineNo,
      glAccountId: creditId,
      debit: 0,
      credit: cashOut,
    });
    this.assertLinesBalanced(lines, 'Expense');

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Expense payment — ${input.vendorLabel} (${input.categoryLabel})`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.Expense,
        sourceId: input.expenseId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /**
   * Petty cash: `in` = Dr Cash / Cr Bank;
   * `out` = Dr OpEx (+WHT) + Dr Input Tax / Cr Tax Payable (WHT) + Cr Cash (total−WHT)
   */
  async postPettyCash(
    tx: Tx,
    input: {
      entryId: string;
      branchId: string;
      entryDate: Date;
      entryType: 'in' | 'out';
      principal: number;
      inputTax: number;
      whtPayable?: number;
      total: number;
      categoryLabel: string;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(JournalSourceType.PettyCash, input.entryId, tx)
    ) {
      return null;
    }

    const total = round2(input.total);
    if (total <= 0) {
      throw new BadRequestException('Petty cash total must be positive');
    }

    const cashId = await this.resolveAccountId(GL_CODES.CASH, tx);
    const bankId = await this.resolveAccountId(GL_CODES.BANK, tx);
    const entryNo = await this.nextEntryNo(tx);

    let lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }>;

    if (input.entryType === 'in') {
      lines = [
        { lineNo: 1, glAccountId: cashId, debit: total, credit: 0 },
        { lineNo: 2, glAccountId: bankId, debit: 0, credit: total },
      ];
    } else {
      const opexId = await this.resolveAccountId(
        GL_CODES.OPERATING_EXPENSE,
        tx,
      );
      const principal = round2(input.principal);
      const inputTax = round2(input.inputTax);
      const wht = round2(input.whtPayable ?? 0);
      const cashOut = round2(principal + inputTax - wht);
      if (cashOut < -0.001) {
        throw new BadRequestException(
          'WHT cannot exceed principal + input tax',
        );
      }
      lines = [
        { lineNo: 1, glAccountId: opexId, debit: principal, credit: 0 },
      ];
      let lineNo = 2;
      if (inputTax > 0) {
        const taxId = await this.resolveAccountId(GL_CODES.INPUT_TAX, tx);
        lines.push({
          lineNo: lineNo++,
          glAccountId: taxId,
          debit: inputTax,
          credit: 0,
        });
      }
      if (wht > 0) {
        const whtId = await this.resolveAccountId(GL_CODES.TAX_PAYABLE, tx);
        lines.push({
          lineNo: lineNo++,
          glAccountId: whtId,
          debit: 0,
          credit: wht,
        });
      }
      lines.push({
        lineNo,
        glAccountId: cashId,
        debit: 0,
        credit: cashOut,
      });
    }
    this.assertLinesBalanced(lines, 'Petty cash');

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Petty cash ${input.entryType === 'in' ? 'replenishment' : 'expense'} — ${input.categoryLabel}`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.PettyCash,
        sourceId: input.entryId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /**
   * Contra transfer between cash/bank GL accounts.
   * Bank↔Bank and Cash↔Cash skip GL (same control account; sub-ledger only).
   */
  async postContra(
    tx: Tx,
    input: {
      contraId: string;
      branchId: string;
      entryDate: Date;
      amount: number;
      fromIsCash: boolean;
      toIsCash: boolean;
      description: string;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(JournalSourceType.Contra, input.contraId, tx)
    ) {
      return null;
    }

    if (input.fromIsCash === input.toIsCash) {
      return null;
    }

    const amount = round2(input.amount);
    if (amount <= 0) {
      throw new BadRequestException('Contra amount must be positive');
    }

    const fromId = await this.resolveAccountId(
      input.fromIsCash ? GL_CODES.CASH : GL_CODES.BANK,
      tx,
    );
    const toId = await this.resolveAccountId(
      input.toIsCash ? GL_CODES.CASH : GL_CODES.BANK,
      tx,
    );
    const entryNo = await this.nextEntryNo(tx);

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: input.description,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.Contra,
        sourceId: input.contraId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: {
          create: [
            { lineNo: 1, glAccountId: toId, debit: amount, credit: 0 },
            { lineNo: 2, glAccountId: fromId, debit: 0, credit: amount },
          ],
        },
      },
      include: { lines: true },
    });
  }

  /**
   * Payroll process accrual:
   * Dr Payroll + Dr OpEx(reimb) / Cr Salary Payable (net+reimb) + Cr Tax Payable
   */
  async postPayrollAccrual(
    tx: Tx,
    input: {
      payrollRunId: string;
      branchId: string;
      entryDate: Date;
      period: string;
      employeeCount: number;
      totalGross: number;
      totalTax: number;
      totalNet: number;
      totalReimbursements: number;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(
        JournalSourceType.Payroll,
        input.payrollRunId,
        tx,
      )
    ) {
      return null;
    }

    const gross = round2(input.totalGross);
    const tax = round2(input.totalTax);
    const net = round2(input.totalNet);
    const reimb = round2(input.totalReimbursements);
    const payable = round2(net + reimb);

    if (Math.abs(gross + reimb - (tax + payable)) > 0.02) {
      throw new BadRequestException(
        `Payroll accrual unbalanced: gross+reimb ${gross + reimb} vs tax+payable ${tax + payable}`,
      );
    }

    const payrollId = await this.resolveAccountId(GL_CODES.PAYROLL, tx);
    const salaryPayId = await this.resolveAccountId(
      GL_CODES.SALARY_PAYABLE,
      tx,
    );
    const taxId = await this.resolveAccountId(GL_CODES.TAX_PAYABLE, tx);

    const lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }> = [{ lineNo: 1, glAccountId: payrollId, debit: gross, credit: 0 }];
    let lineNo = 2;
    if (reimb > 0) {
      const opexId = await this.resolveAccountId(
        GL_CODES.OPERATING_EXPENSE,
        tx,
      );
      lines.push({ lineNo, glAccountId: opexId, debit: reimb, credit: 0 });
      lineNo += 1;
    }
    if (tax > 0) {
      lines.push({ lineNo, glAccountId: taxId, debit: 0, credit: tax });
      lineNo += 1;
    }
    lines.push({
      lineNo,
      glAccountId: salaryPayId,
      debit: 0,
      credit: payable,
    });
    this.assertLinesBalanced(lines, 'Payroll accrual');

    const entryNo = await this.nextEntryNo(tx);
    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Payroll accrual — ${input.period} (${input.employeeCount} employees)`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.Payroll,
        sourceId: input.payrollRunId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  /**
   * Payroll cash settlement after accrual: Dr Salary Payable / Cr Bank.
   * Legacy (no accrual): full disbursement under PayrollPayment.
   */
  async postPayrollPayment(
    tx: Tx,
    input: {
      payrollRunId: string;
      branchId: string;
      entryDate: Date;
      period: string;
      employeeCount: number;
      totalGross: number;
      totalTax: number;
      totalNet: number;
      totalReimbursements: number;
      actorId?: string;
    },
  ) {
    if (
      await this.alreadyPosted(
        JournalSourceType.PayrollPayment,
        input.payrollRunId,
        tx,
      )
    ) {
      return null;
    }

    const accrued = await this.alreadyPosted(
      JournalSourceType.Payroll,
      input.payrollRunId,
      tx,
    );
    const net = round2(input.totalNet);
    const reimb = round2(input.totalReimbursements);
    const bank = round2(net + reimb);
    const bankId = await this.resolveAccountId(GL_CODES.BANK, tx);
    const entryNo = await this.nextEntryNo(tx);

    if (accrued) {
      const salaryPayId = await this.resolveAccountId(
        GL_CODES.SALARY_PAYABLE,
        tx,
      );
      const lines = [
        { lineNo: 1, glAccountId: salaryPayId, debit: bank, credit: 0 },
        { lineNo: 2, glAccountId: bankId, debit: 0, credit: bank },
      ];
      this.assertLinesBalanced(lines, 'Payroll payment');
      return tx.journalEntry.create({
        data: {
          entryNo,
          entryDate: input.entryDate,
          branchId: input.branchId,
          description: `Payroll payment — ${input.period} (${input.employeeCount} employees)`,
          approvalStatus: ApprovalStatus.Approved,
          sourceType: JournalSourceType.PayrollPayment,
          sourceId: input.payrollRunId,
          isAutoPosted: true,
          postedAt: new Date(),
          createdById: input.actorId,
          approvedById: input.actorId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    }

    const gross = round2(input.totalGross);
    const tax = round2(input.totalTax);
    if (Math.abs(gross + reimb - (tax + bank)) > 0.02) {
      throw new BadRequestException(
        `Payroll JE unbalanced: gross+reimb ${gross + reimb} vs tax+bank ${tax + bank}`,
      );
    }

    const payrollId = await this.resolveAccountId(GL_CODES.PAYROLL, tx);
    const taxId = await this.resolveAccountId(GL_CODES.TAX_PAYABLE, tx);
    const lines: Array<{
      lineNo: number;
      glAccountId: string;
      debit: number;
      credit: number;
    }> = [{ lineNo: 1, glAccountId: payrollId, debit: gross, credit: 0 }];
    let lineNo = 2;
    if (reimb > 0) {
      const opexId = await this.resolveAccountId(
        GL_CODES.OPERATING_EXPENSE,
        tx,
      );
      lines.push({ lineNo, glAccountId: opexId, debit: reimb, credit: 0 });
      lineNo += 1;
    }
    if (tax > 0) {
      lines.push({ lineNo, glAccountId: taxId, debit: 0, credit: tax });
      lineNo += 1;
    }
    lines.push({ lineNo, glAccountId: bankId, debit: 0, credit: bank });
    this.assertLinesBalanced(lines, 'Payroll payment');

    return tx.journalEntry.create({
      data: {
        entryNo,
        entryDate: input.entryDate,
        branchId: input.branchId,
        description: `Payroll disbursement — ${input.period} (${input.employeeCount} employees)`,
        approvalStatus: ApprovalStatus.Approved,
        sourceType: JournalSourceType.PayrollPayment,
        sourceId: input.payrollRunId,
        isAutoPosted: true,
        postedAt: new Date(),
        createdById: input.actorId,
        approvedById: input.actorId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function lineCommissionAmount(
  tuitionFee: number,
  scholarship: number,
  commissionRate: number,
  bonus: number,
) {
  return round2((tuitionFee - scholarship) * (commissionRate / 100) + bonus);
}
