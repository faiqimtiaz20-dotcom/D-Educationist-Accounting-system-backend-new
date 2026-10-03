import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  @Get()
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  catalog(@CurrentUser() user: AuthUserPayload) {
    return this.reports.catalog(user);
  }

  @Get(':slug/csv')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('period') period?: string,
    @Query('universityId') universityId?: string,
    @Query('counsellorId') counsellorId?: string,
    @Query('country') country?: string,
  ) {
    const payload = await this.reports.run(
      slug,
      user,
      this.scope(user, req, branchId),
      { from, to, period, universityId, counsellorId, country, branchId },
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slug}.csv"`,
    );
    const csv = this.reports.toCsv(payload);
    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }

  @Get(':slug')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  run(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('period') period?: string,
    @Query('universityId') universityId?: string,
    @Query('counsellorId') counsellorId?: string,
    @Query('country') country?: string,
  ) {
    return this.reports.run(slug, user, this.scope(user, req, branchId), {
      from,
      to,
      period,
      universityId,
      counsellorId,
      country,
      branchId,
    });
  }
}
