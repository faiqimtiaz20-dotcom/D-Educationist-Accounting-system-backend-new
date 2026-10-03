import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  PayrollRunStatus,
  PayrollSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FiscalLockService } from '../accounting/fiscal-lock.service';
import { GlPostingService, round2 } from '../accounting/gl-posting.service';
import { computeSalary } from './salary-tax';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import {
  ImportPayrollDto,
  ProcessPayrollDto,
} from './dto/payroll.dto';
import { nextBranchYearNo, nextMasterNo } from '../common/document-numbers';

const runInclude = {
  branch: { select: { id: true, code: true, name: true, isHeadOffice: true } },
  processedBy: { select: { id: true, fullName: true } },
  lines: {
    include: {
      employee: {
        select: { id: true, fullName: true, designation: true, branchId: true },
      },
    },
  },
} satisfies Prisma.PayrollRunInclude;

@Injectable()
export class PayrollService {
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

  private mapRun(
    row: Prisma.PayrollRunGetPayload<{ include: typeof runInclude }>,
  ) {
    return {
      ...row,
      totalGross: Number(row.totalGross),
      totalTax: Number(row.totalTax),
      totalNet: Number(row.totalNet),
      totalReimbursements: Number(row.totalReimbursements),
      runDate: row.runDate.toISOString().slice(0, 10),
      paidDate: row.paidDate ? row.paidDate.toISOString().slice(0, 10) : null,
      processedByName: row.processedBy?.fullName ?? null,
      lines: row.lines.map((l) => ({
        id: l.id,
        payrollRunId: l.payrollRunId,
        employeeId: l.employeeId,
        employeeName: l.employee.fullName,
        designation: l.employee.designation,
        basicSalary: Number(l.basicSalary),
        allowances: Number(l.allowances),
        grossSalary: Number(l.grossSalary),
        salaryTax: Number(l.salaryTax),
        netSalary: Number(l.netSalary),
        reimbursements: Number(l.reimbursements),
        totalPayable: Number(l.totalPayable),
      })),
    };
  }

  list(scope: RequestBranchScope, period?: string) {
    return this.prisma.payrollRun
      .findMany({
        where: {
          ...(scope.allBranches
            ? {}
            : { branchId: scope.branchId ?? undefined }),
          ...(period ? { period } : {}),
        },
        include: runInclude,
        orderBy: [{ period: 'desc' }, { runDate: 'desc' }],
      })
      .then((rows) => rows.map((r) => this.mapRun(r)));
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: runInclude,
    });
    if (!row) throw new NotFoundException('Payroll run not found');
    this.assertBranch(scope, row.branchId);
    return this.mapRun(row);
  }

  listSlabs() {
    return this.prisma.salaryTaxSlab.findMany({
      orderBy: { minAnnual: 'asc' },
    });
  }

  /**
   * Process internal payroll for a branch/period (→ Processed).
   * HO branch includes all active employees (FE parity).
   */
  async process(
    dto: ProcessPayrollDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    this.assertBranch(scope, dto.branchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const existing = await this.prisma.payrollRun.findUnique({
      where: {
        branchId_period_source: {
          branchId: dto.branchId,
          period: dto.period,
          source: PayrollSource.Internal,
        },
      },
    });
    if (
      existing &&
      (existing.status === PayrollRunStatus.Processed ||
        existing.status === PayrollRunStatus.Paid)
    ) {
      throw new ConflictException(
        `Payroll for ${dto.period} already ${existing.status.toLowerCase()}`,
      );
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(branch.isHeadOffice ? {} : { branchId: dto.branchId }),
      },
      orderBy: { fullName: 'asc' },
    });
    if (employees.length === 0) {
      throw new BadRequestException('No active employees for this branch');
    }

    const [y, m] = dto.period.split('-').map(Number);
    const periodFrom = new Date(Date.UTC(y, m - 1, 1));
    const periodTo = new Date(Date.UTC(y, m, 1));

    const approvedReimbs = await this.prisma.reimbursement.findMany({
      where: {
        status: ApprovalStatus.Approved,
        reimbursementDate: { gte: periodFrom, lt: periodTo },
        payrollRunId: null,
        employeeId: { in: employees.map((e) => e.id) },
      },
    });
    const reimbByEmp = new Map<string, number>();
    for (const r of approvedReimbs) {
      reimbByEmp.set(
        r.employeeId,
        round2((reimbByEmp.get(r.employeeId) ?? 0) + Number(r.amount)),
      );
    }

    const runDate = new Date();
    await this.fiscal.assertNotLocked(runDate);

    const lineData = employees.map((emp) => {
      const { gross, salaryTax, netSalary } = computeSalary(
        Number(emp.basicSalary),
        Number(emp.allowances),
      );
      const reimbursements = reimbByEmp.get(emp.id) ?? 0;
      return {
        employeeId: emp.id,
        basicSalary: round2(Number(emp.basicSalary)),
        allowances: round2(Number(emp.allowances)),
        grossSalary: gross,
        salaryTax,
        netSalary,
        reimbursements,
        totalPayable: round2(netSalary + reimbursements),
      };
    });

    const totalGross = round2(lineData.reduce((s, l) => s + l.grossSalary, 0));
    const totalTax = round2(lineData.reduce((s, l) => s + l.salaryTax, 0));
    const totalNet = round2(lineData.reduce((s, l) => s + l.netSalary, 0));
    const totalReimbursements = round2(
      lineData.reduce((s, l) => s + l.reimbursements, 0),
    );

    const run = await this.prisma.$transaction(async (tx) => {
      if (existing?.status === PayrollRunStatus.Draft) {
        await tx.payrollLine.deleteMany({ where: { payrollRunId: existing.id } });
        await tx.payrollRun.delete({ where: { id: existing.id } });
      }

      const created = await tx.payrollRun.create({
        data: {
          runNo: await nextBranchYearNo(tx, dto.branchId, {
            model: 'payrollRun',
            field: 'runNo',
            docPrefix: 'PR',
          }),
          period: dto.period,
          branchId: dto.branchId,
          status: PayrollRunStatus.Processed,
          runDate,
          source: PayrollSource.Internal,
          totalGross,
          totalTax,
          totalNet,
          totalReimbursements,
          employeeCount: lineData.length,
          processedById: user.id,
          lines: { create: lineData },
        },
        include: runInclude,
      });

      if (approvedReimbs.length > 0) {
        await tx.reimbursement.updateMany({
          where: { id: { in: approvedReimbs.map((r) => r.id) } },
          data: { payrollRunId: created.id },
        });
      }

      await this.gl.postPayrollAccrual(tx, {
        payrollRunId: created.id,
        branchId: dto.branchId,
        entryDate: runDate,
        period: dto.period,
        employeeCount: lineData.length,
        totalGross,
        totalTax,
        totalNet,
        totalReimbursements,
        actorId: user.id,
      });

      return created;
    });

    await this.audit.log({
      userId: user.id,
      action: 'PROCESS',
      module: 'Payroll',
      entityType: 'PayrollRun',
      entityId: run.id,
      afterData: {
        period: dto.period,
        totalGross,
        totalTax,
        employeeCount: lineData.length,
      },
    });

    return this.mapRun(run);
  }

  async import(
    dto: ImportPayrollDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    if (!dto.branchGroups.length) {
      throw new BadRequestException('No payroll lines to import');
    }

    const runDate = new Date();
    await this.fiscal.assertNotLocked(runDate);

    const runIds: string[] = [];
    let employeesCreated = 0;

    for (const group of dto.branchGroups) {
      this.assertBranch(scope, group.branchId);
      if (!group.lines.length) continue;

      const existing = await this.prisma.payrollRun.findUnique({
        where: {
          branchId_period_source: {
            branchId: group.branchId,
            period: dto.period,
            source: PayrollSource.Uploaded,
          },
        },
      });
      if (
        existing &&
        (existing.status === PayrollRunStatus.Processed ||
          existing.status === PayrollRunStatus.Paid)
      ) {
        throw new ConflictException(
          `Uploaded payroll for branch already exists for ${dto.period}`,
        );
      }

      const lineCreates: Array<{
        employeeId: string;
        basicSalary: number;
        allowances: number;
        grossSalary: number;
        salaryTax: number;
        netSalary: number;
        reimbursements: number;
        totalPayable: number;
      }> = [];

      for (const line of group.lines) {
        let emp = await this.findEmployeeMatch(
          group.branchId,
          line.employeeName,
          line.employeeCode,
        );
        if (!emp) {
          const employeeNo = await nextMasterNo(this.prisma, {
            model: 'employee',
            field: 'employeeNo',
            prefix: 'EMP-',
          });
          emp = await this.prisma.employee.create({
            data: {
              employeeNo,
              fullName: line.employeeName.trim(),
              branchId: group.branchId,
              designation: line.designation.trim() || 'Staff',
              basicSalary: round2(line.basicSalary),
              allowances: round2(line.allowances),
              isActive: true,
            },
          });
          employeesCreated += 1;
        }

        lineCreates.push({
          employeeId: emp.id,
          basicSalary: round2(line.basicSalary),
          allowances: round2(line.allowances),
          grossSalary: round2(line.grossSalary),
          salaryTax: round2(line.salaryTax),
          netSalary: round2(line.netSalary),
          reimbursements: round2(line.reimbursements),
          totalPayable: round2(line.totalPayable),
        });
      }

      const totalGross = round2(
        lineCreates.reduce((s, l) => s + l.grossSalary, 0),
      );
      const totalTax = round2(lineCreates.reduce((s, l) => s + l.salaryTax, 0));
      const totalNet = round2(lineCreates.reduce((s, l) => s + l.netSalary, 0));
      const totalReimbursements = round2(
        lineCreates.reduce((s, l) => s + l.reimbursements, 0),
      );

      const run = await this.prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.payrollLine.deleteMany({
            where: { payrollRunId: existing.id },
          });
          await tx.payrollRun.delete({ where: { id: existing.id } });
        }
        const created = await tx.payrollRun.create({
          data: {
            runNo: await nextBranchYearNo(tx, group.branchId, {
              model: 'payrollRun',
              field: 'runNo',
              docPrefix: 'PR',
            }),
            period: dto.period,
            branchId: group.branchId,
            status: PayrollRunStatus.Processed,
            runDate,
            source: PayrollSource.Uploaded,
            totalGross,
            totalTax,
            totalNet,
            totalReimbursements,
            employeeCount: lineCreates.length,
            processedById: user.id,
            lines: { create: lineCreates },
          },
        });
        await this.gl.postPayrollAccrual(tx, {
          payrollRunId: created.id,
          branchId: group.branchId,
          entryDate: runDate,
          period: dto.period,
          employeeCount: lineCreates.length,
          totalGross,
          totalTax,
          totalNet,
          totalReimbursements,
          actorId: user.id,
        });
        return created;
      });
      runIds.push(run.id);
    }

    await this.audit.log({
      userId: user.id,
      action: 'IMPORT',
      module: 'Payroll',
      entityType: 'PayrollRun',
      afterData: {
        period: dto.period,
        runIds,
        employeesCreated,
      },
    });

    const runs = await this.prisma.payrollRun.findMany({
      where: { id: { in: runIds } },
      include: runInclude,
    });

    return {
      runIds,
      employeesCreated,
      runs: runs.map((r) => this.mapRun(r)),
    };
  }

  private async findEmployeeMatch(
    branchId: string,
    name: string,
    code?: string,
  ) {
    const scoped = await this.prisma.employee.findMany({
      where: { branchId, deletedAt: null },
    });
    if (code) {
      const normalized = code
        .trim()
        .toUpperCase()
        .replace(/^EMP-0*/, '');
      const byCode = scoped.find((e) => {
        const digits = e.id.replace(/\D/g, '').slice(-4);
        const display = `EMP-${digits.padStart(4, '0')}`;
        return (
          e.id.toLowerCase() === code.toLowerCase() ||
          display === code.trim().toUpperCase() ||
          digits === normalized
        );
      });
      if (byCode) return byCode;
    }
    const nameLower = name.trim().toLowerCase();
    return scoped.find((e) => e.fullName.trim().toLowerCase() === nameLower);
  }

  async markPaid(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: runInclude,
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    this.assertBranch(scope, run.branchId);
    if (run.status !== PayrollRunStatus.Processed) {
      throw new ConflictException('Only processed payroll can be marked paid');
    }

    const paidDate = new Date();
    await this.fiscal.assertNotLocked(paidDate);

    const updated = await this.prisma.$transaction(async (tx) => {
      const je = await this.gl.postPayrollPayment(tx, {
        payrollRunId: run.id,
        branchId: run.branchId,
        entryDate: paidDate,
        period: run.period,
        employeeCount: run.employeeCount,
        totalGross: Number(run.totalGross),
        totalTax: Number(run.totalTax),
        totalNet: Number(run.totalNet),
        totalReimbursements: Number(run.totalReimbursements),
        actorId: user.id,
      });

      return tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.Paid,
          paidDate,
          ...(je ? { journalEntryId: je.id } : {}),
        },
        include: runInclude,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'PAY',
      module: 'Payroll',
      entityType: 'PayrollRun',
      entityId: id,
      afterData: { period: run.period, paidDate: paidDate.toISOString() },
    });

    return this.mapRun(updated);
  }
}
