import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  createTenantExtendedPrisma,
  type TenantPrismaClient,
} from './tenant-prisma';

/**
 * Nest-injectable Prisma client with MT3 tenant query extension at runtime.
 * Typed as PrismaClient so existing TransactionClient call sites keep compiling.
 */
export interface PrismaService extends PrismaClient {}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: TenantPrismaClient;

  constructor() {
    this.client = createTenantExtendedPrisma();
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (
          prop === 'onModuleInit' ||
          prop === 'onModuleDestroy' ||
          prop === 'logger' ||
          prop === 'client' ||
          prop === 'then'
        ) {
          return Reflect.get(target, prop, receiver);
        }
        const value = Reflect.get(target.client as object, prop);
        return typeof value === 'function'
          ? value.bind(target.client)
          : value;
      },
    }) as unknown as PrismaService;
  }

  async onModuleInit() {
    try {
      await this.client.$connect();
      this.logger.log('Connected to PostgreSQL (tenant-scoped client)');
    } catch (error) {
      this.logger.warn(
        `PostgreSQL not connected yet. Set DATABASE_URL and run migrations. (${String(error)})`,
      );
    }
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
