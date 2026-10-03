import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { resolveWritableBranchId } from '../common/branch-scope';
import { ROLE_CODES } from '../common/rbac';
import { currentTenantId } from '../common/tenant-scope';
import {
  CreateStudentDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from './dto/student.dto';

const studentInclude = {
  university: { select: { id: true, name: true, countryName: true, currencyCode: true } },
  counsellor: { select: { id: true, fullName: true, email: true } },
  branch: { select: { id: true, code: true, name: true } },
  subAgent: { select: { id: true, name: true } },
} satisfies Prisma.StudentInclude;

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private isCounsellor(user: AuthUserPayload) {
    return user.roleCode === ROLE_CODES.COUNSELLOR;
  }

  private assertBranchAccess(scope: RequestBranchScope, branchId: string) {
    if (!scope.allBranches && scope.branchId !== branchId) {
      throw new ForbiddenException('Cross-branch access is not allowed');
    }
  }

  private assertCounsellorAccess(user: AuthUserPayload, counsellorId: string) {
    if (this.isCounsellor(user) && counsellorId !== user.id) {
      throw new ForbiddenException('Counsellors may only access their own students');
    }
  }

  async list(
    user: AuthUserPayload,
    scope: RequestBranchScope,
    query: ListStudentsQueryDto,
  ) {
    if (query.branchId) this.assertBranchAccess(scope, query.branchId);

    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      ...(scope.allBranches
        ? query.branchId
          ? { branchId: query.branchId }
          : {}
        : { branchId: scope.branchId! }),
      ...(this.isCounsellor(user)
        ? { counsellorId: user.id }
        : query.counsellorId
          ? { counsellorId: query.counsellorId }
          : {}),
      ...(query.universityId ? { universityId: query.universityId } : {}),
      ...(query.country
        ? { country: { equals: query.country, mode: 'insensitive' } }
        : {}),
      ...(query.status ? { applicationStatus: query.status } : {}),
      ...(query.intake
        ? { intake: { equals: query.intake, mode: 'insensitive' } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { studentCode: { contains: query.q, mode: 'insensitive' } },
              { course: { contains: query.q, mode: 'insensitive' } },
              { university: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const take =
      query.take != null
        ? Math.min(Math.max(Number(query.take), 1), 500)
        : undefined;
    const skip =
      take != null ? Math.max(Number(query.skip ?? 0), 0) : undefined;

    if (take == null) {
      return this.prisma.student.findMany({
        where,
        include: studentInclude,
        orderBy: [{ updatedAt: 'desc' }, { studentCode: 'asc' }],
      });
    }

    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: studentInclude,
        orderBy: [{ updatedAt: 'desc' }, { studentCode: 'asc' }],
        take,
        skip,
      }),
      this.prisma.student.count({ where }),
    ]);

    return { items, total, take, skip: skip ?? 0 };
  }

  async get(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const row = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
      include: studentInclude,
    });
    if (!row) throw new NotFoundException('Student not found');
    this.assertBranchAccess(scope, row.branchId);
    this.assertCounsellorAccess(user, row.counsellorId);
    return row;
  }

  async listStatusHistory(
    id: string,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    await this.get(id, user, scope);
    return this.prisma.studentStatusHistory.findMany({
      where: { studentId: id },
      orderBy: { changedAt: 'desc' },
      include: {
        changedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async create(dto: CreateStudentDto, user: AuthUserPayload, scope: RequestBranchScope) {
    const branchId = resolveWritableBranchId(scope, dto.branchId);
    this.assertBranchAccess(scope, branchId);

    let counsellorId = dto.counsellorId;
    if (this.isCounsellor(user)) {
      counsellorId = user.id;
    }

    await this.validateRefs({
      branchId,
      counsellorId,
      universityId: dto.universityId,
      subAgentId: dto.subAgentId,
      currencyCode: dto.currencyCode,
    });

    const code = dto.studentCode.trim();
    const existing = await this.prisma.student.findUnique({
      where: {
        tenantId_studentCode: { tenantId: currentTenantId(), studentCode: code },
      },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Student code ${code} already exists`);
    }

    const status = dto.applicationStatus ?? ApplicationStatus.Applied;

    const row = await this.prisma.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          studentCode: code,
          fullName: dto.fullName.trim(),
          cnicPassport: dto.cnicPassport.trim(),
          contact: dto.contact?.trim() || null,
          email: dto.email?.trim() || null,
          branchId,
          counsellorId,
          country: dto.country.trim(),
          universityId: dto.universityId,
          course: dto.course.trim(),
          intake: dto.intake.trim(),
          studentGroup: dto.studentGroup?.trim() || null,
          applicationStatus: status,
          subAgentId: dto.subAgentId || null,
          tuitionFee: dto.tuitionFee,
          scholarship: dto.scholarship ?? 0,
          expectedCommissionRate: dto.expectedCommissionRate,
          currencyCode: dto.currencyCode.toUpperCase(),
          createdById: user.id,
          updatedById: user.id,
        },
        include: studentInclude,
      });

      await tx.studentStatusHistory.create({
        data: {
          studentId: student.id,
          fromStatus: null,
          toStatus: status,
          changedById: user.id,
          note: 'Initial status',
        },
      });

      return student;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Master Sheet',
      entityType: 'Student',
      entityId: row.id,
      afterData: row as unknown as Prisma.InputJsonValue,
    });

    return row;
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    user: AuthUserPayload,
    scope: RequestBranchScope,
  ) {
    const before = await this.get(id, user, scope);

    const nextBranchId = dto.branchId ?? before.branchId;
    this.assertBranchAccess(scope, nextBranchId);
    if (!scope.allBranches && dto.branchId && dto.branchId !== before.branchId) {
      throw new ForbiddenException('Cannot move student to another branch');
    }

    let nextCounsellorId = dto.counsellorId ?? before.counsellorId;
    if (this.isCounsellor(user)) {
      if (dto.counsellorId && dto.counsellorId !== user.id) {
        throw new ForbiddenException('Counsellors cannot reassign students');
      }
      nextCounsellorId = user.id;
    }

    await this.validateRefs({
      branchId: nextBranchId,
      counsellorId: nextCounsellorId,
      universityId: dto.universityId ?? before.universityId,
      subAgentId:
        dto.subAgentId !== undefined ? dto.subAgentId : before.subAgentId,
      currencyCode: dto.currencyCode ?? before.currencyCode,
    });

    if (dto.studentCode) {
      const code = dto.studentCode.trim();
      const clash = await this.prisma.student.findFirst({
        where: {
          studentCode: code,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (clash) throw new ConflictException(`Student code ${code} already exists`);
    }

    const nextStatus = dto.applicationStatus ?? before.applicationStatus;
    const statusChanged = nextStatus !== before.applicationStatus;

    const row = await this.prisma.$transaction(async (tx) => {
      const student = await tx.student.update({
        where: { id },
        data: {
          ...(dto.studentCode !== undefined
            ? { studentCode: dto.studentCode.trim() }
            : {}),
          ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
          ...(dto.cnicPassport !== undefined
            ? { cnicPassport: dto.cnicPassport.trim() }
            : {}),
          ...(dto.contact !== undefined
            ? { contact: dto.contact?.trim() || null }
            : {}),
          ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
          branchId: nextBranchId,
          counsellorId: nextCounsellorId,
          ...(dto.country !== undefined ? { country: dto.country.trim() } : {}),
          ...(dto.universityId !== undefined
            ? { universityId: dto.universityId }
            : {}),
          ...(dto.course !== undefined ? { course: dto.course.trim() } : {}),
          ...(dto.intake !== undefined ? { intake: dto.intake.trim() } : {}),
          ...(dto.studentGroup !== undefined
            ? { studentGroup: dto.studentGroup?.trim() || null }
            : {}),
          ...(dto.applicationStatus !== undefined
            ? { applicationStatus: dto.applicationStatus }
            : {}),
          ...(dto.subAgentId !== undefined
            ? { subAgentId: dto.subAgentId || null }
            : {}),
          ...(dto.tuitionFee !== undefined ? { tuitionFee: dto.tuitionFee } : {}),
          ...(dto.scholarship !== undefined
            ? { scholarship: dto.scholarship }
            : {}),
          ...(dto.expectedCommissionRate !== undefined
            ? { expectedCommissionRate: dto.expectedCommissionRate }
            : {}),
          ...(dto.currencyCode !== undefined
            ? { currencyCode: dto.currencyCode.toUpperCase() }
            : {}),
          updatedById: user.id,
        },
        include: studentInclude,
      });

      if (statusChanged) {
        await tx.studentStatusHistory.create({
          data: {
            studentId: id,
            fromStatus: before.applicationStatus,
            toStatus: nextStatus,
            changedById: user.id,
          },
        });
      }

      return student;
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      module: 'Master Sheet',
      entityType: 'Student',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: row as unknown as Prisma.InputJsonValue,
    });

    return row;
  }

  async softDelete(id: string, user: AuthUserPayload, scope: RequestBranchScope) {
    const before = await this.get(id, user, scope);

    const invoiceLine = await this.prisma.invoiceLine.findFirst({
      where: { studentId: id },
      select: { id: true },
    });
    if (invoiceLine) {
      throw new ConflictException(
        'Cannot delete student linked to an invoice line',
      );
    }

    await this.prisma.student.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });

    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Master Sheet',
      entityType: 'Student',
      entityId: id,
      beforeData: before as unknown as Prisma.InputJsonValue,
    });

    return { success: true };
  }

  private async validateRefs(input: {
    branchId: string;
    counsellorId: string;
    universityId: string;
    subAgentId?: string | null;
    currencyCode: string;
  }) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, isActive: true },
    });
    if (!branch) throw new BadRequestException('Invalid branch');

    const counsellor = await this.prisma.user.findFirst({
      where: { id: input.counsellorId, deletedAt: null, isActive: true },
      include: { role: true },
    });
    if (!counsellor) throw new BadRequestException('Invalid counsellor');

    const university = await this.prisma.university.findFirst({
      where: { id: input.universityId, deletedAt: null, isActive: true },
    });
    if (!university) throw new BadRequestException('Invalid university');

    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode.toUpperCase() },
    });
    if (!currency) throw new BadRequestException('Invalid currency');

    if (input.subAgentId) {
      const sub = await this.prisma.subAgent.findFirst({
        where: { id: input.subAgentId, deletedAt: null, isActive: true },
      });
      if (!sub) throw new BadRequestException('Invalid sub-agent');
    }
  }
}
