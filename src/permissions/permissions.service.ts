import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from '../common/decorators';
import { canEditPermissionMatrix } from '../common/rbac';
import { UpdatePermissionMatrixDto } from './dto/permission.dto';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMatrix() {
    const [roles, modules, rows] = await Promise.all([
      this.prisma.role.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.appModule.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.roleModulePermission.findMany({
        include: { role: true, module: true },
      }),
    ]);

    const matrix = modules.map((module) => {
      const permissions: Record<string, string> = {};
      for (const role of roles) {
        const hit = rows.find(
          (r) => r.roleId === role.id && r.moduleId === module.id,
        );
        permissions[role.code] = hit?.level ?? 'none';
        permissions[role.name] = hit?.level ?? 'none';
      }
      return {
        moduleCode: module.code,
        moduleName: module.name,
        permissions,
      };
    });

    return { roles, modules, matrix };
  }

  async updateMatrix(dto: UpdatePermissionMatrixDto, actor: AuthUserPayload) {
    if (!canEditPermissionMatrix(actor.roleCode)) {
      throw new ForbiddenException('Only Super Admin can edit the matrix');
    }

    const before = await this.getMatrix();

    for (const cell of dto.cells) {
      const role = await this.prisma.role.findUnique({
        where: { code: cell.roleCode },
      });
      const module = await this.prisma.appModule.findUnique({
        where: { code: cell.moduleCode },
      });
      if (!role || !module) {
        throw new BadRequestException(
          `Unknown role/module ${cell.roleCode}/${cell.moduleCode}`,
        );
      }
      if (role.code === 'SUPER_ADMIN' || role.code === 'TENANT_ADMIN') {
        // Tenant Admin stays full on all modules — ignore downgrades
        await this.prisma.roleModulePermission.upsert({
          where: {
            roleId_moduleId: { roleId: role.id, moduleId: module.id },
          },
          create: { roleId: role.id, moduleId: module.id, level: 'full' },
          update: { level: 'full' },
        });
        continue;
      }
      if (role.code === 'CRM_ADMIN') {
        // Platform CRM never gets tenant module access via matrix
        await this.prisma.roleModulePermission.upsert({
          where: {
            roleId_moduleId: { roleId: role.id, moduleId: module.id },
          },
          create: { roleId: role.id, moduleId: module.id, level: 'none' },
          update: { level: 'none' },
        });
        continue;
      }

      await this.prisma.roleModulePermission.upsert({
        where: {
          roleId_moduleId: { roleId: role.id, moduleId: module.id },
        },
        create: {
          roleId: role.id,
          moduleId: module.id,
          level: cell.level,
        },
        update: { level: cell.level },
      });
    }

    const after = await this.getMatrix();
    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'PermissionMatrix',
      beforeData: before,
      afterData: after,
    });

    return after;
  }
}
