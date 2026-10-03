import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import { requireTenantId } from '../common/tenant-scope';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    actor: AuthUserPayload,
    scope: RequestBranchScope,
    includeInactive = false,
  ) {
    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });

    const where = {
      deletedAt: null,
      tenantId,
      ...(includeInactive ? {} : { isActive: true }),
      ...(scope.allBranches
        ? {}
        : {
            OR: [
              { id: scope.branchId! },
              { isHeadOffice: true },
            ],
          }),
    };

    return this.prisma.branch.findMany({
      where,
      orderBy: [{ isHeadOffice: 'desc' }, { code: 'asc' }],
    });
  }

  async get(id: string, actor: AuthUserPayload, scope: RequestBranchScope) {
    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });

    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    if (
      !scope.allBranches &&
      branch.id !== scope.branchId &&
      !branch.isHeadOffice
    ) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async create(dto: CreateBranchDto, actor: AuthUserPayload) {
    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.branch.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (exists && !exists.deletedAt) {
      throw new ConflictException(`Branch code ${code} already exists`);
    }

    const branch = await this.prisma.branch.create({
      data: {
        tenantId,
        code,
        name: dto.name.trim(),
        city: dto.city.trim(),
        isHeadOffice: dto.isHeadOffice ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE',
      module: 'Settings',
      entityType: 'Branch',
      entityId: branch.id,
      afterData: branch,
    });

    return branch;
  }

  async update(id: string, dto: UpdateBranchDto, actor: AuthUserPayload) {
    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });
    const before = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Branch not found');

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
        ...(dto.isHeadOffice !== undefined ? { isHeadOffice: dto.isHeadOffice } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'Branch',
      entityId: id,
      beforeData: before,
      afterData: branch,
    });

    return branch;
  }

  async softDelete(id: string, actor: AuthUserPayload) {
    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });
    const before = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Branch not found');

    const branch = await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'Branch',
      entityId: id,
      beforeData: before,
      afterData: branch,
    });
    return { success: true };
  }
}
