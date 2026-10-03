import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ROLE_CODES } from '../common/rbac';
import { TenantContext } from '../common/tenant-context';

export type CreateNotificationInput = {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    entityType: string | null;
    entityId: string | null;
    readAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      entityType: row.entityType,
      entityId: row.entityId,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      isRead: Boolean(row.readAt),
    };
  }

  async create(input: CreateNotificationInput) {
    const row = await this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type.slice(0, 40),
        title: input.title.slice(0, 200),
        body: input.body ?? null,
        link: input.link?.slice(0, 300) ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });
    return this.serialize(row);
  }

  async createMany(inputs: CreateNotificationInput[]) {
    if (!inputs.length) return { count: 0 };
    const result = await this.prisma.notification.createMany({
      data: inputs.map((i) => ({
        tenantId: i.tenantId,
        userId: i.userId,
        type: i.type.slice(0, 40),
        title: i.title.slice(0, 200),
        body: i.body ?? null,
        link: i.link?.slice(0, 300) ?? null,
        entityType: i.entityType ?? null,
        entityId: i.entityId ?? null,
      })),
    });
    return result;
  }

  /** Notify tenant admins + branch managers (+ accountants on that branch). */
  async notifyApprovers(input: {
    tenantId: string;
    branchId: string;
    excludeUserId?: string;
    type: string;
    title: string;
    body?: string;
    link?: string;
    entityType?: string;
    entityId?: string;
  }) {
    const recipients = await this.prisma.user.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        isActive: true,
        ...(input.excludeUserId
          ? { id: { not: input.excludeUserId } }
          : {}),
        OR: [
          {
            role: {
              code: {
                in: [ROLE_CODES.TENANT_ADMIN, ROLE_CODES.SUPER_ADMIN],
              },
            },
          },
          {
            role: { code: ROLE_CODES.BRANCH_MANAGER },
            branchId: input.branchId,
          },
          {
            role: { code: ROLE_CODES.ACCOUNTANT },
            branchId: input.branchId,
          },
        ],
      },
      select: { id: true },
    });

    return this.createMany(
      recipients.map((u) => ({
        tenantId: input.tenantId,
        userId: u.id,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        entityType: input.entityType,
        entityId: input.entityId,
      })),
    );
  }

  private optionalTenantId(): string | null {
    return TenantContext.getTenantId();
  }

  async listForUser(userId: string, opts?: { unreadOnly?: boolean; take?: number }) {
    const tenantId = this.optionalTenantId();
    if (!tenantId) return [];
    const take = Math.min(opts?.take ?? 30, 100);
    const rows = await this.prisma.notification.findMany({
      where: {
        tenantId,
        userId,
        ...(opts?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((r) => this.serialize(r));
  }

  async unreadCount(userId: string) {
    const tenantId = this.optionalTenantId();
    if (!tenantId) return 0;
    return this.prisma.notification.count({
      where: { tenantId, userId, readAt: null },
    });
  }

  async markRead(id: string, userId: string) {
    const tenantId = this.optionalTenantId();
    if (!tenantId) throw new NotFoundException('Notification not found');
    const row = await this.prisma.notification.findFirst({
      where: { id, tenantId, userId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    if (row.userId !== userId) {
      throw new ForbiddenException('Not your notification');
    }
    if (row.readAt) return this.serialize(row);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return this.serialize(updated);
  }

  async markAllRead(userId: string) {
    const tenantId = this.optionalTenantId();
    if (!tenantId) return { success: true, count: 0 };
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, count: result.count };
  }
}
