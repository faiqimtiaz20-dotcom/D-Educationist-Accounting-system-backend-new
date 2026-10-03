import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from '../common/decorators';
import type { RequestBranchScope } from '../common/branch-scope.interceptor';
import {
  ROLE_CODES,
  assignableRoleCodes,
  canManageUsers,
  isTenantAdminRole,
} from '../common/rbac';
import { requireTenantId } from '../common/tenant-scope';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { NotificationsService } from '../notifications/notifications.service';

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  roleId: true,
  tenantId: true,
  branchId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true, city: true } },
} as const;

function isProtectedTenantAdmin(roleCode: string) {
  return isTenantAdminRole(roleCode);
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUserPayload, scope: RequestBranchScope) {
    if (!canManageUsers(actor.roleCode)) {
      throw new ForbiddenException('Cannot list users');
    }

    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });

    const where = scope.allBranches
      ? { deletedAt: null, tenantId }
      : { deletedAt: null, tenantId, branchId: scope.branchId! };

    return this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { fullName: 'asc' },
    });
  }

  async get(id: string, actor: AuthUserPayload, scope: RequestBranchScope) {
    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });

    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('User not found');

    if (!scope.allBranches && user.branchId !== scope.branchId) {
      throw new ForbiddenException('Cross-branch user access denied');
    }

    if (
      !isTenantAdminRole(actor.roleCode) &&
      isProtectedTenantAdmin(user.role.code)
    ) {
      throw new ForbiddenException('Cross-branch user access denied');
    }

    return user;
  }

  private async resolveRole(roleCode: string) {
    const code =
      roleCode === ROLE_CODES.SUPER_ADMIN
        ? ROLE_CODES.TENANT_ADMIN
        : roleCode;
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) throw new BadRequestException(`Unknown role ${roleCode}`);
    return role;
  }

  async create(dto: CreateUserDto, actor: AuthUserPayload) {
    if (!canManageUsers(actor.roleCode)) {
      throw new ForbiddenException('Cannot create users');
    }

    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });

    const allowed = assignableRoleCodes(actor.roleCode);
    if (!allowed.includes(dto.roleCode)) {
      throw new ForbiddenException(`Cannot assign role ${dto.roleCode}`);
    }

    if (
      !isTenantAdminRole(actor.roleCode) &&
      dto.branchId !== actor.branchId
    ) {
      throw new ForbiddenException('Cannot create users in another branch');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('Email already in use');
    }

    const role = await this.resolveRole(dto.roleCode);
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, tenantId, deletedAt: null },
    });
    if (!branch) throw new BadRequestException('Branch not found');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        roleId: role.id,
        tenantId,
        branchId: dto.branchId,
        isActive: dto.isActive ?? true,
      },
      select: userSelect,
    });

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE',
      module: 'Settings',
      entityType: 'User',
      entityId: user.id,
      afterData: { id: user.id, email: user.email, role: user.role.code },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUserPayload) {
    const scope: RequestBranchScope = isTenantAdminRole(actor.roleCode)
      ? { branchId: null, allBranches: true }
      : { branchId: actor.branchId, allBranches: false };
    const before = await this.get(id, actor, scope);

    if (dto.roleCode) {
      const allowed = assignableRoleCodes(actor.roleCode);
      if (
        isProtectedTenantAdmin(before.role.code) &&
        !isTenantAdminRole(actor.roleCode)
      ) {
        throw new ForbiddenException('Cannot modify Tenant Admin');
      }
      if (!allowed.includes(dto.roleCode) && dto.roleCode !== before.role.code) {
        throw new ForbiddenException(`Cannot assign role ${dto.roleCode}`);
      }
    }

    if (
      dto.branchId &&
      !isTenantAdminRole(actor.roleCode) &&
      dto.branchId !== actor.branchId
    ) {
      throw new ForbiddenException('Cannot move user to another branch');
    }

    const tenantId = requireTenantId({
      tenantId: actor.tenantId,
      isPlatform: false,
    });
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, tenantId, deletedAt: null },
      });
      if (!branch) throw new BadRequestException('Branch not found');
    }

    if (
      dto.isActive === false &&
      id === actor.id
    ) {
      throw new BadRequestException('Cannot disable your own account');
    }

    if (
      dto.isActive === false &&
      isProtectedTenantAdmin(before.role.code) &&
      !isTenantAdminRole(actor.roleCode)
    ) {
      throw new ForbiddenException('Cannot disable Tenant Admin');
    }

    const role = dto.roleCode ? await this.resolveRole(dto.roleCode) : null;
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 12)
      : undefined;

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dto.fullName ? { fullName: dto.fullName.trim() } : {}),
        ...(role ? { roleId: role.id } : {}),
        ...(dto.branchId ? { branchId: dto.branchId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: userSelect,
    });

    if (dto.isActive === false) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (
      dto.isActive !== undefined &&
      dto.isActive !== before.isActive &&
      before.tenantId
    ) {
      try {
        const admins = await this.prisma.user.findMany({
          where: {
            tenantId: before.tenantId,
            deletedAt: null,
            isActive: true,
            role: {
              code: {
                in: [ROLE_CODES.TENANT_ADMIN, ROLE_CODES.SUPER_ADMIN],
              },
            },
          },
          select: { id: true },
        });
        await this.notifications.createMany(
          admins
            .filter((a) => a.id !== id)
            .map((a) => ({
            tenantId: before.tenantId!,
            userId: a.id,
            type: dto.isActive ? 'ACCOUNT_ENABLED' : 'ACCOUNT_DISABLED',
            title: dto.isActive
              ? `Account enabled: ${user.fullName}`
              : `Account disabled: ${user.fullName}`,
            body: user.email,
            link: '/settings/users',
            entityType: 'User',
            entityId: id,
          })),
        );
        if (dto.isActive) {
          await this.notifications.create({
            tenantId: before.tenantId,
            userId: id,
            type: 'ACCOUNT_ENABLED',
            title: 'Your account has been re-enabled',
            body: 'You can sign in again.',
            link: '/profile',
            entityType: 'User',
            entityId: id,
          });
        }
      } catch {
        /* non-blocking */
      }
    }

    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'User',
      entityId: id,
      beforeData: before,
      afterData: user,
    });

    return user;
  }

  async softDelete(id: string, actor: AuthUserPayload) {
    if (id === actor.id) {
      throw new BadRequestException('Cannot delete your own account');
    }
    const scope: RequestBranchScope = isTenantAdminRole(actor.roleCode)
      ? { branchId: null, allBranches: true }
      : { branchId: actor.branchId, allBranches: false };
    const before = await this.get(id, actor, scope);
    if (
      isProtectedTenantAdmin(before.role.code) &&
      !isTenantAdminRole(actor.roleCode)
    ) {
      throw new ForbiddenException('Cannot delete Tenant Admin');
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'User',
      entityId: id,
      beforeData: before,
    });

    return { success: true };
  }

  listRoles() {
    return this.prisma.role.findMany({
      where: {
        code: {
          notIn: [ROLE_CODES.CRM_ADMIN, ROLE_CODES.SUPER_ADMIN],
        },
      },
      orderBy: { name: 'asc' },
    });
  }
}
