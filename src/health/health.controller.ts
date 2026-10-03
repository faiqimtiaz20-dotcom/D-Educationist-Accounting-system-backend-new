import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let database: 'up' | 'down' | 'unconfigured' = 'unconfigured';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: 'ok',
      service: 'd-educationist-accounting-api',
      milestone: 'M15',
      database,
      note:
        database === 'up'
          ? 'API process is running and PostgreSQL responded.'
          : 'API process is running. PostgreSQL is not reachable yet — set DATABASE_URL and run migrations.',
    };
  }
}
