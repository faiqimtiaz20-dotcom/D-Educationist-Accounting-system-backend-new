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
import { TaxType } from '@prisma/client';
import { TaxService } from './tax.service';
import { CreateTaxRecordDto, UpdateTaxRecordDto } from './dto/tax.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  @Get('summary')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'read')
  summary(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.tax.summary(this.scope(user, req, branchId), period);
  }

  @Get('records')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'read')
  listRecords(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('taxType') taxType?: TaxType,
  ) {
    return this.tax.listRecords(this.scope(user, req, branchId), {
      period,
      taxType,
    });
  }

  @Post('records')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'full')
  createRecord(
    @Body() dto: CreateTaxRecordDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.tax.createManual(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('records/:id')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'full')
  updateRecord(
    @Param('id') id: string,
    @Body() dto: UpdateTaxRecordDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.tax.updateManual(id, dto, user, this.scope(user, req));
  }

  @Delete('records/:id')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'full')
  deleteRecord(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.tax.deleteManual(id, user, this.scope(user, req));
  }
}
