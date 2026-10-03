import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { computeSalary } from './salary-tax';
import { round2 } from '../accounting/gl-posting.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/payroll.dto';
import { nextMasterNo } from '../common/document-numbers';

const include = {
  branch: { select: { id: true, code: true, name: true, isHeadOffice: true } },
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertBranch(scope: RequestBranchScope, branchId: string) {
    if (!scope.allBranches && scope.branchId !== branchId) {
      throw new ForbiddenException('Cross-branch access is not allowed');
    }
  }

  private map(row: Prisma.EmployeeGetPayload<{ include: typeof include }>) {
    const { gross, salaryTax, netSalary } = computeSalary(
      Number(row.basicSalary),
      Number(row.allowances),
    );
    return {
      ...row,
      basicSalary: Number(row.basicSalary),
      allowances: Number(row.allowances),
      grossSalary: gross,
      salaryTax,
      netSalary,
    };
  }

  async list(scope: RequestBranchScope, includeInactive = false) {
    const rows = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
        ...(scope.allBranches ? {} : { branchId: scope.branchId ?? undefined }),
      },
      include,
      orderBy: { fullName: 'asc' },
    });
    return rows.map((r) => this.map(r));
  }

  async get(id: string, scope: RequestBranchScope) {
    const row = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include,
    });
    if (!row) throw new NotFoundException('Employee not found');
    this.assertBranch(scope, row.branchId);
    return this.map(row);
  }

  async create(
    dto: CreateEmployeeDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    this.assertBranch(scope, dto.branchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const row = await this.prisma.$transaction(async (tx) => {
      const employeeNo = await nextMasterNo(tx, {
        model: 'employee',
        field: 'employeeNo',
        prefix: 'EMP-',
      });
      return tx.employee.create({
        data: {
          employeeNo,
          fullName: dto.fullName.trim(),
          branchId: dto.branchId,
          designation: dto.designation.trim(),
          basicSalary: round2(dto.basicSalary),
          allowances: round2(dto.allowances ?? 0),
          email: dto.email?.trim() || null,
          bankAccount: dto.bankAccount?.trim() || null,
          isActive: dto.isActive ?? true,
        },
        include,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Payroll',
      entityType: 'Employee',
      entityId: row.id,
      afterData: { fullName: row.fullName, branchId: row.branchId },
    });

    return this.map(row);
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const existing = await this.get(id, scope);
    if (dto.branchId) this.assertBranch(scope, dto.branchId);

    const row = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined
          ? { fullName: dto.fullName.trim() }
          : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.designation !== undefined
          ? { designation: dto.designation.trim() }
          : {}),
        ...(dto.basicSalary !== undefined
          ? { basicSalary: round2(dto.basicSalary) }
          : {}),
        ...(dto.allowances !== undefined
          ? { allowances: round2(dto.allowances) }
          : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.trim() || null }
          : {}),
        ...(dto.bankAccount !== undefined
          ? { bankAccount: dto.bankAccount?.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include,
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Payroll',
      entityType: 'Employee',
      entityId: id,
      beforeData: { fullName: existing.fullName },
      afterData: { fullName: row.fullName },
    });

    return this.map(row);
  }

  async remove(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    await this.get(id, scope);
    await this.prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Payroll',
      entityType: 'Employee',
      entityId: id,
    });
    return { ok: true };
  }
}
