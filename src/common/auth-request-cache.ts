import type { PermissionLevel } from '@prisma/client';
import type { AuthUserPayload } from './decorators';
import { TtlCache } from './ttl-cache';

/** ~45s: balances remote-DB cost vs deactivated/suspended user propagation. */
export const authUserCache = new TtlCache<AuthUserPayload>(45_000);

/** moduleCode → module id */
export const appModuleIdCache = new TtlCache<string>(5 * 60_000);

/** `${roleId}:${moduleId}` → permission level */
export const rolePermissionCache = new TtlCache<PermissionLevel>(45_000);

export function invalidateAuthUserCache(userId: string) {
  authUserCache.delete(userId);
}

/** Role permission matrix is small — clear all on any role/permission mutation. */
export function invalidateRolePermissionCache() {
  rolePermissionCache.clear();
}
