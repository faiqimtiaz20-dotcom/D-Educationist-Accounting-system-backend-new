import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ROLE_CODES } from '../common/rbac';
import { TenantContext } from '../common/tenant-context';
import { TenantTemplateService } from './tenant-template.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
} from './dto/tenant.dto';

/**
 * MT5 CRM tenant lifecycle.
 * Soft status only (D7) — no seat/plan numeric limits enforced in v1.
 */

const CITY_BRANCH_CODES: Record<string, string> = {
  karachi: 'KHI',
  lahore: 'LHR',
  islamabad: 'ISB',
  rawalpindi: 'RWP',
  multan: 'MUL',
  faisalabad: 'FSD',
  peshawar: 'PEW',
  quetta: 'QTA',
};

function cityToBranchCode(city: string, reserved: Set<string>): string {
  const key = city.trim().toLowerCase();
  let code =
    CITY_BRANCH_CODES[key] ??
    city.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
  if (code.length < 2) code = 'MAIN';
  if (reserved.has(code)) code = 'MAIN';
  if (reserved.has(code)) code = 'BR1';
  return code;
}

@Injectable()
export class CrmTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly template: TenantTemplateService,
  ) {}

  list(includeDeleted = false) {
    TenantContext.enter({ tenantId: null, isPlatform: true });
    return this.prisma.tenant.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { code: 'asc' },
      include: {
        _count: {
          select: { users: true, branches: true },
        },
      },
    });
  }

  async get(id: string) {
    TenantContext.enter({ tenantId: null, isPlatform: true });
    const row = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        branches: {
          where: { deletedAt: null },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            city: true,
            isHeadOffice: true,
            isActive: true,
          },
        },
        _count: { select: { users: true, students: true } },
      },
    });
    if (!row) throw new NotFoundException('Tenant not found');
    return row;
  }

  async create(dto: CreateTenantDto, actorId: string) {
    TenantContext.enter({ tenantId: null, isPlatform: true });

    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.tenant.findUnique({ where: { code } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Tenant code ${code} already exists`);
    }

    const email = dto.adminEmail.trim().toLowerCase();
    const emailTaken = await this.prisma.user.findUnique({ where: { email } });
    if (emailTaken && !emailTaken.deletedAt) {
      throw new ConflictException('Admin email already in use');
    }

    const role = await this.prisma.role.findUnique({
      where: { code: ROLE_CODES.TENANT_ADMIN },
    });
    if (!role) {
      throw new BadRequestException('TENANT_ADMIN role missing — run seed');
    }

    const branchCode = (dto.branchCode ?? 'HO').trim().toUpperCase();
    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
    const status = dto.status ?? TenantStatus.Active;
    const orgName = (dto.orgName ?? dto.name).trim();
    const city = (dto.branchCity ?? 'Karachi').trim();
    const hoCode = 'HO';
    const operatingCode =
      branchCode !== hoCode
        ? branchCode
        : cityToBranchCode(city, new Set([hoCode]));
    const operatingName = (
      dto.branchName ?? `${city} Branch`
    ).trim();

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          code,
          name: dto.name.trim(),
          status,
        },
      });

      const hoBranch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          code: hoCode,
          name: 'Head Office',
          city,
          isHeadOffice: true,
          isActive: true,
        },
      });

      const operatingBranch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          code: operatingCode,
          name: operatingName,
          city,
          isHeadOffice: false,
          isActive: true,
        },
      });

      const admin = await tx.user.create({
        data: {
          email,
          fullName: dto.adminFullName.trim(),
          passwordHash,
          roleId: role.id,
          tenantId: tenant.id,
          branchId: hoBranch.id,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          roleId: true,
          tenantId: true,
          branchId: true,
        },
      });

      return { tenant, branch: hoBranch, operatingBranch, admin };
    });

    await this.template.provision(result.tenant.id, {
      orgName,
      whtRatePercent: 1,
      fiscalPeriodLockedUntil: null,
    });

    await this.audit.log({
      userId: actorId,
      tenantId: null,
      action: 'CREATE',
      module: 'CRM',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      afterData: {
        code: result.tenant.code,
        name: result.tenant.name,
        status: result.tenant.status,
        adminEmail: result.admin.email,
        branchCode: result.branch.code,
        operatingBranchCode: result.operatingBranch.code,
        note: 'v1: no seat/plan numeric limits enforced (D7 status-only)',
      },
    });

    return {
      tenant: result.tenant,
      branch: result.branch,
      operatingBranch: result.operatingBranch,
      admin: result.admin,
      limitsEnforced: false,
      limitsNote:
        'D7: Active/Suspended/Trial status only — no payment gateway or seat caps in v1',
    };
  }

  async update(id: string, dto: UpdateTenantDto, actorId: string) {
    TenantContext.enter({ tenantId: null, isPlatform: true });
    const before = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Tenant not found');

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    await this.audit.log({
      userId: actorId,
      tenantId: null,
      action: 'UPDATE',
      module: 'CRM',
      entityType: 'Tenant',
      entityId: id,
      beforeData: before,
      afterData: tenant,
    });

    return tenant;
  }

  async setStatus(id: string, status: TenantStatus, actorId: string) {
    return this.update(id, { status }, actorId);
  }

  async softDelete(id: string, actorId: string) {
    TenantContext.enter({ tenantId: null, isPlatform: true });
    const before = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Tenant not found');

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: TenantStatus.Suspended,
      },
    });

    await this.audit.log({
      userId: actorId,
      tenantId: null,
      action: 'DELETE',
      module: 'CRM',
      entityType: 'Tenant',
      entityId: id,
      beforeData: before,
      afterData: tenant,
    });

    return { success: true };
  }
}
