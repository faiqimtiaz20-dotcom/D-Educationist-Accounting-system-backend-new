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
import { StudentsService } from './students.service';
import {
  CreateStudentDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from './dto/student.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  @Get()
  @RequirePermission(MODULE_CODES.MASTER_SHEET, 'read')
  list(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query() query: ListStudentsQueryDto,
  ) {
    return this.students.list(
      user,
      this.scope(user, req, query.branchId),
      query,
    );
  }

  @Get(':id')
  @RequirePermission(MODULE_CODES.MASTER_SHEET, 'read')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.students.get(id, user, this.scope(user, req, branchId));
  }

  @Get(':id/status-history')
  @RequirePermission(MODULE_CODES.MASTER_SHEET, 'read')
  statusHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.students.listStatusHistory(
      id,
      user,
      this.scope(user, req, branchId),
    );
  }

  @Post()
  @RequirePermission(MODULE_CODES.MASTER_SHEET, 'full')
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.students.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch(':id')
  @RequirePermission(MODULE_CODES.MASTER_SHEET, 'full')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.students.update(
      id,
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Delete(':id')
  @RequirePermission(MODULE_CODES.MASTER_SHEET, 'full')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.students.softDelete(id, user, this.scope(user, req));
  }
}
