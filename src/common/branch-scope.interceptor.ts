import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUserPayload } from './decorators';
import { resolveBranchScope } from './branch-scope';
import { isCrmAdminRole } from './rbac';

export type RequestBranchScope = {
  branchId: string | null;
  allBranches: boolean;
};

/**
 * Attaches `req.branchScope` from the authenticated user + optional `?branchId=`.
 * Controllers/services must still apply the filter — this makes scope consistent.
 * CRM Admin gets a noop scope (platform) — business controllers still 403 via permissions.
 */
@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthUserPayload;
      query?: { branchId?: string };
      branchScope?: RequestBranchScope;
    }>();

    if (req.user) {
      if (isCrmAdminRole(req.user.roleCode)) {
        req.branchScope = { branchId: null, allBranches: false };
      } else {
        req.branchScope = resolveBranchScope(req.user, req.query?.branchId);
      }
    }

    return next.handle();
  }
}
