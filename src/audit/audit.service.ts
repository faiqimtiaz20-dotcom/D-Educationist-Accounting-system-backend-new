import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    userId?: string | null;
    /** Explicit null = platform/CRM audit (overrides schema default). */
    tenantId?: string | null;
    action: AuditAction;
    module: string;
    entityType?: string;
    entityId?: string;
    beforeData?: Prisma.InputJsonValue;
    afterData?: Prisma.InputJsonValue;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    return this.prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
        action: input.action,
        module: input.module,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeData: input.beforeData,
        afterData: input.afterData,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }
}
