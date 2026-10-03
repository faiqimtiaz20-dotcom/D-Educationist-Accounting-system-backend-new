import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { CrmTenantsService } from './crm-tenants.service';
import {
  CreateTenantDto,
  TenantStatusDto,
  UpdateTenantDto,
} from './dto/tenant.dto';
import {
  CurrentUser,
  PlatformRoute,
  RequireRoles,
  type AuthUserPayload,
} from '../common/decorators';
import { ROLE_CODES } from '../common/rbac';

/**
 * Platform CRM tenant lifecycle (MT5).
 * Gated to CRM_ADMIN only — Tenant Admins receive 403.
 */
@Controller('crm/tenants')
@PlatformRoute()
@RequireRoles(ROLE_CODES.CRM_ADMIN)
export class CrmTenantsController {
  constructor(private readonly tenants: CrmTenantsService) {}

  @Get()
  list(@Query('includeDeleted') includeDeleted?: string) {
    return this.tenants.list(includeDeleted === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post()
  create(@Body() dto: CreateTenantDto, @CurrentUser() user: AuthUserPayload) {
    return this.tenants.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.tenants.update(id, dto, user.id);
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.tenants.setStatus(id, TenantStatus.Suspended, user.id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.tenants.setStatus(id, TenantStatus.Active, user.id);
  }

  /** Optional explicit status set (Active | Suspended | Trial). */
  @Post(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() dto: TenantStatusDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.tenants.setStatus(id, dto.status, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.tenants.softDelete(id, user.id);
  }
}
