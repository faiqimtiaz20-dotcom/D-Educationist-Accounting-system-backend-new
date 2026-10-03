import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CommissionsService } from './commissions.service';
import { PaymentsService } from './payments.service';
import {
  CreateCommissionDto,
  CreatePaymentDto,
  UpdateCommissionDto,
} from './dto/payables.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class PayablesController {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly payments: PaymentsService,
  ) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Commissions ───────────────────────────────────────────────────────────

  @Get('sub-agent-commissions')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'read')
  listCommissions(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('subAgentId') subAgentId?: string,
  ) {
    return this.commissions.list(
      this.scope(user, req, branchId),
      subAgentId,
    );
  }

  @Get('sub-agent-commissions/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'read')
  getCommission(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.commissions.get(id, this.scope(user, req));
  }

  @Post('sub-agent-commissions')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  createCommission(
    @Body() dto: CreateCommissionDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.commissions.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('sub-agent-commissions/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  updateCommission(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.commissions.update(id, dto, user, this.scope(user, req));
  }

  @Delete('sub-agent-commissions/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  deleteCommission(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.commissions.remove(id, user, this.scope(user, req));
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  @Get('sub-agent-payments')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'read')
  listPayments(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('subAgentId') subAgentId?: string,
  ) {
    return this.payments.list(this.scope(user, req, branchId), subAgentId);
  }

  @Get('sub-agent-payments/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'read')
  getPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payments.get(id, this.scope(user, req));
  }

  @Post('sub-agent-payments')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  createPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payments.create(dto, user, this.scope(user, req));
  }

  @Delete('sub-agent-payments/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  deletePayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payments.remove(id, user, this.scope(user, req));
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  @Get('sub-agents/:id/ledger')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'read')
  ledger(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.commissions.ledger(id, this.scope(user, req, branchId));
  }
}
