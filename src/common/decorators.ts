import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { PermissionLevel } from '@prisma/client';

export type AuthUserPayload = {
  id: string;
  email: string;
  fullName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  /** Null for platform CRM_ADMIN. */
  tenantId: string | null;
  /** Null for platform CRM_ADMIN. */
  branchId: string | null;
  branchCode: string | null;
  /** True when the user's home branch is Head Office. */
  branchIsHeadOffice: boolean;
  /**
   * True for TENANT_ADMIN / legacy SUPER_ADMIN, or Head Office
   * BRANCH_MANAGER / ACCOUNTANT (all branches within tenant).
   */
  isSuperAdmin: boolean;
  /** Same as isSuperAdmin for branch data scope (explicit name for clients). */
  canViewAllBranches: boolean;
  isCrmAdmin: boolean;
};

export const CURRENT_USER_KEY = 'user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUserPayload }>();
    return request.user;
  },
);

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSION_KEY = 'permission';
export type PermissionRequirement = {
  moduleCode: string;
  minLevel: PermissionLevel;
};

export const RequirePermission = (
  moduleCode: string,
  minLevel: PermissionLevel = 'read',
) => SetMetadata(PERMISSION_KEY, { moduleCode, minLevel } satisfies PermissionRequirement);

export const ROLES_KEY = 'roles';
export const RequireRoles = (...roleCodes: string[]) =>
  SetMetadata(ROLES_KEY, roleCodes);

/** Marks routes as platform/CRM (allowed for CRM_ADMIN via CrmBoundaryGuard). */
export const PLATFORM_ROUTE_KEY = 'platformRoute';
export const PlatformRoute = () => SetMetadata(PLATFORM_ROUTE_KEY, true);
