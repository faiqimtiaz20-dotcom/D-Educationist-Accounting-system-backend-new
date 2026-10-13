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
import { InvoiceStatus } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { OtherInvoicesService } from './other-invoices.service';
import { ReceivablesService } from './receivables.service';
import {
  ConfirmAllocationDto,
  CreateInvoiceDto,
  CreateOtherInvoiceDto,
  CreateReceivableDto,
  UpdateInvoiceDto,
  UpdateOtherInvoiceDto,
} from './dto/revenue.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class RevenueController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly otherInvoices: OtherInvoicesService,
    private readonly receivables: ReceivablesService,
  ) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Invoices ──────────────────────────────────────────────────────────────

  @Get('invoices')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'read')
  listInvoices(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('status') status?: InvoiceStatus,
  ) {
    return this.invoices.list(this.scope(user, req, branchId), status);
  }

  @Get('invoices/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'read')
  getInvoice(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.get(id, this.scope(user, req));
  }

  @Post('invoices')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  createInvoice(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.create(dto, user, this.scope(user, req, dto.branchId));
  }

  @Patch('invoices/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  updateInvoice(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.update(id, dto, user, this.scope(user, req));
  }

  @Post('invoices/:id/send')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  sendInvoice(
    @Param('id') id: string,
    @Body()
    body: { to?: string; cc?: string; subject?: string; body?: string },
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.send(id, user, this.scope(user, req), body);
  }

  @Delete('invoices/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  deleteInvoice(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.invoices.softDelete(id, user, this.scope(user, req));
  }

  // ── Other invoices ────────────────────────────────────────────────────────

  @Get('other-invoices')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'read')
  listOther(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.otherInvoices.list(this.scope(user, req, branchId));
  }

  @Get('other-invoices/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'read')
  getOther(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.otherInvoices.get(id, this.scope(user, req));
  }

  @Post('other-invoices')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  createOther(
    @Body() dto: CreateOtherInvoiceDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.otherInvoices.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('other-invoices/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  updateOther(
    @Param('id') id: string,
    @Body() dto: UpdateOtherInvoiceDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.otherInvoices.update(id, dto, user, this.scope(user, req));
  }

  @Delete('other-invoices/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  deleteOther(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.otherInvoices.softDelete(id, user, this.scope(user, req));
  }

  // ── Receivables / allocation ───────────────────────────────────────────────

  @Get('receivables')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'read')
  listReceivables(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.receivables.list(this.scope(user, req, branchId));
  }

  @Get('receivables/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'read')
  getReceivable(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.receivables.get(id, this.scope(user, req));
  }

  @Post('receivables')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  createReceivable(
    @Body() dto: CreateReceivableDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.receivables.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Post('receivables/:id/allocate')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  allocate(
    @Param('id') id: string,
    @Body() dto: ConfirmAllocationDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.receivables.confirmAllocation(
      id,
      dto,
      user,
      this.scope(user, req),
    );
  }

  @Delete('receivables/:id')
  @RequirePermission(MODULE_CODES.INVOICES_RECEIVABLES, 'full')
  deleteReceivable(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.receivables.softDelete(id, user, this.scope(user, req));
  }
}
