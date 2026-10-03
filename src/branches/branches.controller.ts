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
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import {
  CurrentUser,
  RequirePermission,
  RequireRoles,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES, ROLE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  /** Lookup for filters/dropdowns — any authenticated tenant user (scoped). */
  @Get()
  list(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('includeInactive') includeInactive?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.branches.list(
      user,
      this.scope(user, req, branchId),
      includeInactive === 'true',
    );
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.branches.get(id, user, this.scope(user, req, branchId));
  }

  @Post()
  @RequireRoles(ROLE_CODES.TENANT_ADMIN)
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  create(@Body() dto: CreateBranchDto, @CurrentUser() user: AuthUserPayload) {
    return this.branches.create(dto, user);
  }

  @Patch(':id')
  @RequireRoles(ROLE_CODES.TENANT_ADMIN)
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.branches.update(id, dto, user);
  }

  @Delete(':id')
  @RequireRoles(ROLE_CODES.TENANT_ADMIN)
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.branches.softDelete(id, user);
  }
}
