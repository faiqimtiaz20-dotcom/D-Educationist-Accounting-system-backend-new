import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DashboardService } from './dashboard.service';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  @Get('metrics')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  metrics(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.dashboard.metrics(this.scope(user, req, branchId));
  }

  @Get('charts/commission-by-university')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  commissionByUniversity(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('take') take?: string,
  ) {
    return this.dashboard.commissionByUniversity(
      this.scope(user, req, branchId),
      take ? Number(take) : 7,
    );
  }

  @Get('charts/receivables-ageing')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  receivablesAgeing(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.dashboard.receivablesAgeing(this.scope(user, req, branchId));
  }

  @Get('charts/branch-profit')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  branchProfit(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.dashboard.branchProfit(this.scope(user, req, branchId));
  }

  @Get('charts/monthly-trend')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  monthlyTrend(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('months') months?: string,
  ) {
    return this.dashboard.monthlyTrend(
      this.scope(user, req, branchId),
      months ? Number(months) : 7,
    );
  }

  @Get('counsellor')
  @RequirePermission(MODULE_CODES.DASHBOARD_REPORTS, 'read')
  counsellor(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.dashboard.counsellorDashboard(
      user,
      this.scope(user, req, branchId),
    );
  }
}
