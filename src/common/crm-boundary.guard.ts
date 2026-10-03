import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  PLATFORM_ROUTE_KEY,
  type AuthUserPayload,
} from './decorators';
import { isCrmAdminRole } from './rbac';

/**
 * Blocks CRM_ADMIN from tenant business APIs.
 * CRM may only hit auth/session routes and @PlatformRoute handlers (MT5+).
 */
@Injectable()
export class CrmBoundaryGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isPlatform = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPlatform) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthUserPayload;
      url?: string;
      originalUrl?: string;
    }>();
    const user = request.user;
    if (!user || !isCrmAdminRole(user.roleCode)) return true;

    const url = (request.originalUrl || request.url || '').split('?')[0];
    if (
      url === '/api/v1/auth/me' ||
      url === '/api/v1/auth/logout' ||
      url === '/api/v1/auth/refresh' ||
      url.startsWith('/api/v1/auth/')
    ) {
      return true;
    }

    throw new ForbiddenException(
      'CRM Admin cannot access tenant business modules',
    );
  }
}
