import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUserPayload,
  PERMISSION_KEY,
  PermissionRequirement,
  ROLES_KEY,
} from './decorators';
import { isCrmAdminRole, permissionAtLeast } from './rbac';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length && !requirement) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUserPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('No authenticated user');

    // CRM Admin: platform only — never pass tenant business module checks
    if (isCrmAdminRole(user.roleCode)) {
      if (requirement) {
        throw new ForbiddenException(
          'CRM Admin cannot access tenant business modules',
        );
      }
      if (requiredRoles?.length && !requiredRoles.includes(user.roleCode)) {
        throw new ForbiddenException('Insufficient role');
      }
      return true;
    }

    if (requiredRoles?.length && !requiredRoles.includes(user.roleCode)) {
      // Allow legacy SUPER_ADMIN / TENANT_ADMIN synonym for RequireRoles
      const tenantAdminAliases = new Set(['SUPER_ADMIN', 'TENANT_ADMIN']);
      const wantsTenantAdmin = requiredRoles.some((r) =>
        tenantAdminAliases.has(r),
      );
      const isTenantAdmin = tenantAdminAliases.has(user.roleCode);
      if (!(wantsTenantAdmin && isTenantAdmin)) {
        throw new ForbiddenException('Insufficient role');
      }
    }

    if (!requirement) return true;

    if (user.isSuperAdmin) return true;

    const module = await this.prisma.appModule.findUnique({
      where: { code: requirement.moduleCode },
    });
    if (!module) {
      throw new ForbiddenException(`Unknown module ${requirement.moduleCode}`);
    }

    const row = await this.prisma.roleModulePermission.findUnique({
      where: {
        roleId_moduleId: { roleId: user.roleId, moduleId: module.id },
      },
    });

    const level = row?.level ?? 'none';
    if (!permissionAtLeast(level, requirement.minLevel)) {
      throw new ForbiddenException(
        `Requires ${requirement.moduleCode} >= ${requirement.minLevel}`,
      );
    }
    return true;
  }
}
