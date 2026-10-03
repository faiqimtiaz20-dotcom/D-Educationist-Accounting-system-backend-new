import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from './decorators';

/**
 * Breadcrumb audit for mutating Approvals / Documents HTTP calls.
 * Domain services also write richer audit rows; this ensures every critical
 * queue/file action has an HTTP-level trail with IP / user-agent.
 */
@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      user?: AuthUserPayload;
      ip?: string;
      headers?: Record<string, string | undefined>;
    }>();

    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const path = req.originalUrl || req.url || '';
    const critical =
      /\/approvals(\/|$)/.test(path) || /\/documents(\/|$)/.test(path);
    if (!critical || !req.user) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit.log({
            userId: req.user!.id,
            action: method === 'DELETE' ? AuditAction.DELETE : AuditAction.OTHER,
            module: path.includes('/documents') ? 'Documents' : 'Approvals',
            entityType: 'HttpMutation',
            afterData: { method, path: path.slice(0, 220) },
            ip: req.ip ?? null,
            userAgent: req.headers?.['user-agent'] ?? null,
          });
        },
      }),
    );
  }
}
