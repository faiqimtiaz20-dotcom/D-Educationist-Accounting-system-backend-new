import { Body, Controller, Get, Put } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { UpdatePermissionMatrixDto } from './dto/permission.dto';
import {
  CurrentUser,
  RequirePermission,
  RequireRoles,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES, ROLE_CODES } from '../common/rbac';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('matrix')
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  getMatrix() {
    return this.permissions.getMatrix();
  }

  @Put('matrix')
  @RequireRoles(ROLE_CODES.TENANT_ADMIN)
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updateMatrix(
    @Body() dto: UpdatePermissionMatrixDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.permissions.updateMatrix(dto, user);
  }
}
