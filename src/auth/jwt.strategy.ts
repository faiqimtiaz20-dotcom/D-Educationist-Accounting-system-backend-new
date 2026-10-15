import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUserPayload } from '../common/decorators';
import { authUserCache } from '../common/auth-request-cache';
import {
  canAccessAllTenantBranches,
  isCrmAdminRole,
  isTenantAdminRole,
} from '../common/rbac';
import { TenantContext } from '../common/tenant-context';

type JwtPayload = {
  sub: string;
  email: string;
  roleCode: string;
  branchId: string | null;
  tenantId: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') || 'dev-only-access-secret',
    });
  }

  private bindTenant(user: AuthUserPayload) {
    if (isCrmAdminRole(user.roleCode)) {
      TenantContext.enter({ tenantId: null, isPlatform: true });
    } else if (user.tenantId) {
      TenantContext.enter({ tenantId: user.tenantId, isPlatform: false });
    }
  }

  async validate(payload: JwtPayload): Promise<AuthUserPayload> {
    const cached = authUserCache.get(payload.sub);
    if (cached) {
      if (
        payload.tenantId != null &&
        cached.tenantId != null &&
        payload.tenantId !== cached.tenantId
      ) {
        throw new UnauthorizedException('Token tenant mismatch');
      }
      this.bindTenant(cached);
      return cached;
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      include: { role: true, branch: true, tenant: true },
    });
    if (!user) throw new UnauthorizedException('User not found or inactive');

    // Prefer DB truth over JWT claims (reject stale/forged token fields)
    if (
      payload.tenantId != null &&
      user.tenantId != null &&
      payload.tenantId !== user.tenantId
    ) {
      throw new UnauthorizedException('Token tenant mismatch');
    }

    if (
      user.tenantId &&
      user.tenant &&
      user.tenant.status === 'Suspended'
    ) {
      throw new UnauthorizedException('Tenant suspended');
    }

    const branchIsHeadOffice = Boolean(user.branch?.isHeadOffice);
    const canViewAllBranches = canAccessAllTenantBranches(
      user.role.code,
      branchIsHeadOffice,
    );

    const authUser: AuthUserPayload = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      roleCode: user.role.code,
      roleName: user.role.name,
      tenantId: user.tenantId,
      branchId: user.branchId,
      branchCode: user.branch?.code ?? null,
      branchIsHeadOffice,
      isSuperAdmin: isTenantAdminRole(user.role.code),
      canViewAllBranches,
      isCrmAdmin: isCrmAdminRole(user.role.code),
    };

    authUserCache.set(user.id, authUser);
    this.bindTenant(authUser);
    return authUser;
  }
}
