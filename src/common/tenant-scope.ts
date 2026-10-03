import { ForbiddenException } from '@nestjs/common';
import type { AuthUserPayload } from './decorators';
import { isCrmAdminRole } from './rbac';
import { TenantContext } from './tenant-context';

export type RequestTenantScope = {
  /** Null only for platform CRM_ADMIN. */
  tenantId: string | null;
  isPlatform: boolean;
};

/**
 * Resolves tenant scope for the authenticated user.
 * Forged `requestedTenantId` from query/body/header is rejected for tenant users.
 * CRM Admin is platform-scoped (no business tenant) until MT5 tenant APIs.
 */
export function resolveTenantScope(
  user: AuthUserPayload,
  requestedTenantId?: string | null,
): RequestTenantScope {
  if (isCrmAdminRole(user.roleCode)) {
    if (requestedTenantId) {
      throw new ForbiddenException(
        'CRM Admin cannot set tenantId on this request',
      );
    }
    return { tenantId: null, isPlatform: true };
  }

  if (!user.tenantId) {
    throw new ForbiddenException('User is not assigned to a tenant');
  }

  if (requestedTenantId && requestedTenantId !== user.tenantId) {
    throw new ForbiddenException('Cross-tenant access is not allowed');
  }

  return { tenantId: user.tenantId, isPlatform: false };
}

/** Require a concrete tenant id (business APIs). */
export function requireTenantId(scope: RequestTenantScope): string {
  if (!scope.tenantId) {
    throw new ForbiddenException('Tenant context required');
  }
  return scope.tenantId;
}

/**
 * Active request tenant from TenantContext (set by JWT / interceptor).
 * Prefer this over DEFAULT_TENANT_ID for per-tenant masters/settings (MT4).
 */
export function currentTenantId(): string {
  const id = TenantContext.getTenantId();
  if (!id) {
    throw new ForbiddenException('Tenant context required');
  }
  return id;
}
