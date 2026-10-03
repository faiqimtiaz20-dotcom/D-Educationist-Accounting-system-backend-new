import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUserPayload } from './decorators';
import { TenantContext } from './tenant-context';
import {
  resolveTenantScope,
  type RequestTenantScope,
} from './tenant-scope';

function pickRequestedTenantId(req: {
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
}): string | undefined {
  const q = req.query?.tenantId;
  if (typeof q === 'string' && q.trim()) return q.trim();

  const header = req.headers?.['x-tenant-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();

  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const b = (req.body as { tenantId?: unknown }).tenantId;
    if (typeof b === 'string' && b.trim()) return b.trim();
  }
  return undefined;
}

/**
 * Resolves tenant scope, attaches `req.tenantScope`, and binds TenantContext
 * for Prisma tenant extension (MT3).
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthUserPayload;
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, unknown>;
      tenantScope?: RequestTenantScope;
    }>();

    if (req.user) {
      const scope = resolveTenantScope(req.user, pickRequestedTenantId(req));
      req.tenantScope = scope;
      TenantContext.enter({
        tenantId: scope.tenantId,
        isPlatform: scope.isPlatform,
      });
    }

    return next.handle();
  }
}
