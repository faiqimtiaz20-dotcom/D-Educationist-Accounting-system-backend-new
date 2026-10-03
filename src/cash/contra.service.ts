import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContraEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { CreateContraDto } from './dto/cash.dto';
import { nextYearNo } from '../common/document-numbers';

const include = {
  fromBankAccount: { select: { id: true, name: true } },
  toBankAccount: { select: { id: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  journalEntry: { select: { id: true, entryNo: true } },
} satisfies Prisma.ContraEntryInclude;

@Injectable()
export class ContraService {
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
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date ${raw}`);
    }
    return d;
  }

  list(scope: RequestBranchScope) {
    return this.prisma.contraEntry.findMany({
      where: scope.allBranches ? {} : { branchId: scope.branchId! },
      include,
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.contraEntry.findUnique({
      where: { id },
      include,
    });
    if (!row) throw new NotFoundException('Contra entry not found');
    this.assertBranch(scope, row.branchId);
    return row;
  }

  async create(
    dto: CreateContraDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranch(scope, branchId);
    const entryDate = this.parseDate(dto.entryDate);
    await this.fiscal.assertNotLocked(entryDate);

    let fromIsCash = Boolean(dto.fromIsCash);
    let toIsCash = Boolean(dto.toIsCash);
    let fromBankAccountId = dto.fromBankAccountId ?? null;
    let toBankAccountId = dto.toBankAccountId ?? null;

    if (dto.contraType === ContraEntryType.CashBank) {
      // Prefer: cash → bank (fromIsCash=true, to bank account)
      if (!fromIsCash && !toIsCash) {
        fromIsCash = true;
        toIsCash = false;
      }
      if (fromIsCash && !toBankAccountId) {
        throw new BadRequestException(
          'toBankAccountId required for Cash-Bank',
        );
      }
      if (!fromIsCash && !fromBankAccountId) {
        throw new BadRequestException(
          'fromBankAccountId required when withdrawing from bank to cash',
        );
      }
      if (!fromIsCash) toIsCash = true;
    } else if (dto.contraType === ContraEntryType.BankBank) {
      fromIsCash = false;
      toIsCash = false;
      if (!fromBankAccountId || !toBankAccountId) {
        throw new BadRequestException(
          'fromBankAccountId and toBankAccountId required for Bank-Bank',
        );
      }
      if (fromBankAccountId === toBankAccountId) {
        throw new BadRequestException('From and to banks must differ');
      }
    } else if (dto.contraType === ContraEntryType.CashCash) {
      fromIsCash = true;
      toIsCash = true;
      fromBankAccountId = null;
      toBankAccountId = null;
    }

    const amount = round2(dto.amount);

    const fromLabel = fromIsCash
      ? 'Cash in Hand'
      : (
          await this.prisma.bankAccount.findUnique({
            where: { id: fromBankAccountId! },
          })
        )?.name ?? 'Bank';
    const toLabel = toIsCash
      ? 'Cash in Hand'
      : (
          await this.prisma.bankAccount.findUnique({
            where: { id: toBankAccountId! },
          })
        )?.name ?? 'Bank';

    const row = await this.prisma.$transaction(async (tx) => {
      const contraNo = await nextYearNo(tx, {
        model: 'contraEntry',
        field: 'contraNo',
        docPrefix: 'CE',
      });
      const contra = await tx.contraEntry.create({
        data: {
          contraNo,
          branchId,
          entryDate,
          contraType: dto.contraType,
          fromBankAccountId,
          toBankAccountId,
          fromIsCash,
          toIsCash,
          amount,
          createdById: user.id,
        },
      });

      const je = await this.gl.postContra(tx, {
        contraId: contra.id,
        branchId,
        entryDate,
        amount,
        fromIsCash,
        toIsCash,
        description: `Contra ${dto.contraType} — ${fromLabel} → ${toLabel}`,
        actorId: user.id,
      });

      if (je) {
        await tx.contraEntry.update({
          where: { id: contra.id },
          data: { journalEntryId: je.id },
        });
      }

      // Bank movement mirrors when bank accounts involved
      if (!fromIsCash && fromBankAccountId) {
        const acct = await tx.bankAccount.findUnique({
          where: { id: fromBankAccountId },
        });
        await tx.bankTransaction.create({
          data: {
            bankAccountId: fromBankAccountId,
            txnDate: entryDate,
            txnType: 'withdrawal',
            description: `Contra out → ${toLabel}`,
            amount,
            currencyCode: acct?.currencyCode ?? 'PKR',
            counterpartyBankAccountId: toBankAccountId,
            reconciliationStatus: 'Matched',
            sourceType: 'Contra',
            sourceId: contra.id,
          },
        });
      }
      if (!toIsCash && toBankAccountId) {
        const acct = await tx.bankAccount.findUnique({
          where: { id: toBankAccountId },
        });
        await tx.bankTransaction.create({
          data: {
            bankAccountId: toBankAccountId,
            txnDate: entryDate,
            txnType: 'deposit',
            description: `Contra in ← ${fromLabel}`,
            amount,
            currencyCode: acct?.currencyCode ?? 'PKR',
            counterpartyBankAccountId: fromBankAccountId,
            reconciliationStatus: 'Matched',
            sourceType: 'Contra',
            sourceId: contra.id,
          },
        });
      }

      return contra;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Journal Entries',
      entityType: 'ContraEntry',
      entityId: row.id,
      afterData: { amount, contraType: dto.contraType },
    });

    return this.get(row.id, scope);
  }
}
