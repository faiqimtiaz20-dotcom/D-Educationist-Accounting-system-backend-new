import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthUserPayload } from './decorators';
import { isCrmAdminRole, isTenantAdminRole } from './rbac';
import type { RequestBranchScope } from './branch-scope.interceptor';

/**
 * Resolves which branchId a query may use.
 * - Tenant Admin: optional `requested` (undefined = all branches / no filter)
 * - Others: always forced to home branch; requesting another branch is forbidden
 * - CRM Admin: no branch scope (platform)
 */
export function resolveBranchScope(
  user: AuthUserPayload,
  requested?: string | null,
): { branchId: string | null; allBranches: boolean } {
  if (isCrmAdminRole(user.roleCode)) {
    throw new ForbiddenException(
      'CRM Admin cannot access tenant branch-scoped resources',
    );
  }

  if (isTenantAdminRole(user.roleCode)) {
    if (!requested || requested === 'all') {
      return { branchId: null, allBranches: true };
    }
    return { branchId: requested, allBranches: false };
  }

  if (!user.branchId) {
    throw new ForbiddenException('User has no home branch');
  }

  if (requested && requested !== 'all' && requested !== user.branchId) {
    throw new ForbiddenException('Cross-branch access is not allowed');
  }

  return { branchId: user.branchId, allBranches: false };
}

/**
 * Writable branch for creates/updates.
 * Non–tenant-admin callers may not set a foreign `branchId` in the body —
 * that is rejected (403), not silently rewritten.
 */
export function resolveWritableBranchId(
  scope: RequestBranchScope,
  requestedBranchId?: string | null,
): string {
  if (scope.allBranches) {
    if (!requestedBranchId) {
      throw new BadRequestException('branchId is required');
    }
    return requestedBranchId;
  }
  if (requestedBranchId && requestedBranchId !== scope.branchId) {
    throw new ForbiddenException('Cross-branch access is not allowed');
  }
  return scope.branchId!;
}
