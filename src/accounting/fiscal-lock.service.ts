import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { currentTenantId } from '../common/tenant-scope';

@Injectable()
export class FiscalLockService {
  constructor(private readonly prisma: PrismaService) {}

  async getLockedUntil(): Promise<string | null> {
    const tenantId = currentTenantId();
    const row = await this.prisma.systemSetting.findUnique({
      where: {
        tenantId_key: {
          tenantId,
          key: 'fiscal_period_locked_until',
        },
      },
    });
    if (!row || row.value === null) return null;
    if (typeof row.value === 'string') return row.value;
    return String(row.value);
  }

  /** Throws if YYYY-MM-DD (or Date) is on/before the fiscal lock. */
  async assertNotLocked(date: Date | string) {
    const lockedUntil = await this.getLockedUntil();
    if (!lockedUntil) return;
    const d =
      typeof date === 'string'
        ? date.slice(0, 10)
        : date.toISOString().slice(0, 10);
    if (d <= lockedUntil) {
      throw new BadRequestException(
        `Fiscal period locked through ${lockedUntil}; cannot post date ${d}`,
      );
    }
  }
}
