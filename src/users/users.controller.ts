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
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  @Get('roles')
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  roles() {
    return this.users.listRoles();
  }

  @Get()
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  list(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.users.list(user, this.scope(user, req, branchId));
  }

  @Get(':id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.users.get(id, user, this.scope(user, req, branchId));
  }

  @Post()
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUserPayload) {
    return this.users.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.users.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.users.softDelete(id, user);
  }
}
