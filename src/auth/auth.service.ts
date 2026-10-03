import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isCrmAdminRole, isTenantAdminRole } from '../common/rbac';
import {
  ChangePasswordDto,
  LoginDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private accessExpiresIn() {
    return this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m';
  }

  private refreshExpiresMs() {
    const raw = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    if (raw.endsWith('d')) return Number(raw.slice(0, -1)) * 24 * 60 * 60 * 1000;
    if (raw.endsWith('h')) return Number(raw.slice(0, -1)) * 60 * 60 * 1000;
    if (raw.endsWith('m')) return Number(raw.slice(0, -1)) * 60 * 1000;
    return 7 * 24 * 60 * 60 * 1000;
  }

  private serializeUser(user: {
    id: string;
    email: string;
    fullName: string;
    phone?: string | null;
    roleId: string;
    tenantId: string | null;
    branchId: string | null;
    role: { id: string; code: string; name: string };
    branch: { id: string; code: string; name: string; city: string } | null;
    tenant?: {
      id: string;
      code: string;
      name: string;
      status: string;
    } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone ?? null,
      roleId: user.roleId,
      roleCode: user.role.code,
      roleName: user.role.name,
      tenantId: user.tenantId,
      tenantCode: user.tenant?.code ?? null,
      tenantName: user.tenant?.name ?? null,
      tenantStatus: user.tenant?.status ?? null,
      branchId: user.branchId,
      branchCode: user.branch?.code ?? null,
      branchName: user.branch?.name ?? null,
      isSuperAdmin: isTenantAdminRole(user.role.code),
      isCrmAdmin: isCrmAdminRole(user.role.code),
    };
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    tenantId: string | null;
    role: { code: string };
    branchId: string | null;
  }) {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        roleCode: user.role.code,
        branchId: user.branchId,
        tenantId: user.tenantId,
      },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET') || 'dev-only-access-secret',
        expiresIn: this.accessExpiresIn() as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshExpiresMs());
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, expiresAt };
  }

  async login(
    dto: LoginDto,
    meta?: { ip?: string; userAgent?: string },
  ) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { role: true, branch: true, tenant: true },
    });

    const fail = async (reason: string) => {
      await this.audit.log({
        userId: user?.id,
        action: 'LOGIN_FAILED',
        module: 'Auth',
        entityType: 'User',
        entityId: user?.id,
        afterData: { email, reason },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      throw new UnauthorizedException('Invalid email or password');
    };

    if (!user || !user.isActive) await fail('not_found_or_inactive');

    const ok = await bcrypt.compare(dto.password, user!.passwordHash);
    if (!ok) await fail('bad_password');

    // Suspended tenant: login rejected (addendum §6.1.4)
    if (
      user!.tenantId &&
      user!.tenant &&
      user!.tenant.status === 'Suspended'
    ) {
      await fail('tenant_suspended');
    }

    // CRM must be platform (null tenant); tenant staff must have tenantId
    if (isCrmAdminRole(user!.role.code) && user!.tenantId) {
      await fail('crm_must_be_platform');
    }
    if (!isCrmAdminRole(user!.role.code) && !user!.tenantId) {
      await fail('tenant_required');
    }

    const tokens = await this.issueTokens(user!);
    await this.prisma.user.update({
      where: { id: user!.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.log({
      userId: user!.id,
      action: 'LOGIN',
      module: 'Auth',
      entityType: 'User',
      entityId: user!.id,
      afterData: {
        email: user!.email,
        role: user!.role.code,
        tenantId: user!.tenantId,
      },
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: 'Bearer',
      user: this.serializeUser(user!),
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: {
        user: { include: { role: true, branch: true, tenant: true } },
      },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new UnauthorizedException('User inactive');
    }
    if (
      stored.user.tenantId &&
      stored.user.tenant &&
      stored.user.tenant.status === 'Suspended'
    ) {
      throw new UnauthorizedException('Tenant suspended');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(stored.user);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: 'Bearer',
      user: this.serializeUser(stored.user),
    };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.log({
      userId,
      action: 'LOGOUT',
      module: 'Auth',
      entityType: 'User',
      entityId: userId,
    });

    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { role: true, branch: true, tenant: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    if (
      user.tenantId &&
      user.tenant &&
      user.tenant.status === 'Suspended'
    ) {
      throw new UnauthorizedException('Tenant suspended');
    }

    const permissions = await this.prisma.roleModulePermission.findMany({
      where: { roleId: user.roleId },
      include: { module: true },
    });

    return {
      user: this.serializeUser(user),
      permissions: permissions.map((p) => ({
        moduleCode: p.module.code,
        moduleName: p.module.name,
        level: p.level,
      })),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { role: true, branch: true, tenant: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const data: {
      fullName?: string;
      email?: string;
      phone?: string | null;
    } = {};

    if (dto.fullName !== undefined) {
      const name = dto.fullName.trim();
      if (name.length < 2) {
        throw new BadRequestException('Name must be at least 2 characters');
      }
      data.fullName = name;
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== user.email) {
        const clash = await this.prisma.user.findFirst({
          where: { email, deletedAt: null, NOT: { id: userId } },
          select: { id: true },
        });
        if (clash) {
          throw new ConflictException('Email is already in use');
        }
        data.email = email;
      }
    }

    if (dto.phone !== undefined) {
      const phone = dto.phone?.trim() || null;
      data.phone = phone;
    }

    if (Object.keys(data).length === 0) {
      return { user: this.serializeUser(user) };
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { role: true, branch: true, tenant: true },
    });

    await this.audit.log({
      userId,
      action: 'UPDATE',
      module: 'Auth',
      entityType: 'UserProfile',
      entityId: userId,
      beforeData: {
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      },
      afterData: {
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
      },
    });

    return { user: this.serializeUser(updated) };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Invalidate other sessions
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      userId,
      action: 'UPDATE',
      module: 'Auth',
      entityType: 'UserPassword',
      entityId: userId,
      afterData: { passwordChanged: true },
    });

    return { success: true, message: 'Password updated — please sign in again on other devices' };
  }
}
