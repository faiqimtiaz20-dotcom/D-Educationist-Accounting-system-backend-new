import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: {
    module?: string;
    userId?: string;
    entityType?: string;
    entityId?: string;
    action?: AuditAction;
    from?: string;
    to?: string;
    take?: number;
    skip?: number;
  }) {
    const take = Math.min(Math.max(opts.take ?? 100, 1), 500);
    const skip = Math.max(opts.skip ?? 0, 0);
    const where: Prisma.AuditLogWhereInput = {
      ...(opts.module ? { module: opts.module } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.entityType ? { entityType: opts.entityType } : {}),
      ...(opts.entityId ? { entityId: opts.entityId } : {}),
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.from || opts.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: new Date(opts.from) } : {}),
              ...(opts.to
                ? { lte: new Date(`${opts.to.slice(0, 10)}T23:59:59.999Z`) }
                : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user?.fullName ?? 'System',
      action: r.action,
      module: r.module,
      entityType: r.entityType,
      entityId: r.entityId,
      timestamp: r.createdAt.toISOString(),
      ip: r.ip ?? '',
      userAgent: r.userAgent,
      beforeData: r.beforeData,
      afterData: r.afterData,
    }));

    return { items, total, take, skip };
  }
}
