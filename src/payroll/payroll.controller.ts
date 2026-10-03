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
import { ApprovalStatus } from '@prisma/client';
import { EmployeesService } from './employees.service';
import { ReimbursementsService } from './reimbursements.service';
import { PayrollService } from './payroll.service';
import {
  CreateEmployeeDto,
  CreateReimbursementDto,
  ImportPayrollDto,
  ProcessPayrollDto,
  UpdateEmployeeDto,
  UpdateReimbursementStatusDto,
} from './dto/payroll.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class PayrollController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly reimbursements: ReimbursementsService,
    private readonly payroll: PayrollService,
  ) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  @Get('employees')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  listEmployees(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.employees.list(
      this.scope(user, req, branchId),
      includeInactive === '1' || includeInactive === 'true',
    );
  }

  @Get('employees/:id')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  getEmployee(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.employees.get(id, this.scope(user, req));
  }

  @Post('employees')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  createEmployee(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.employees.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('employees/:id')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  updateEmployee(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.employees.update(id, dto, user, this.scope(user, req));
  }

  @Delete('employees/:id')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  deleteEmployee(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.employees.remove(id, user, this.scope(user, req));
  }

  // ── Payroll runs ──────────────────────────────────────────────────────────

  @Get('payroll-runs')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  listRuns(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('period') period?: string,
  ) {
    return this.payroll.list(this.scope(user, req, branchId), period);
  }

  @Get('payroll-runs/:id')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  getRun(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payroll.get(id, this.scope(user, req));
  }

  @Post('payroll-runs/process')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  process(
    @Body() dto: ProcessPayrollDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payroll.process(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Post('payroll-runs/import')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  importRuns(
    @Body() dto: ImportPayrollDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payroll.import(dto, user, this.scope(user, req));
  }

  @Post('payroll-runs/:id/pay')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  markPaid(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.payroll.markPaid(id, user, this.scope(user, req));
  }

  @Get('salary-tax-slabs')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  listSlabs() {
    return this.payroll.listSlabs();
  }

  // ── Reimbursements ────────────────────────────────────────────────────────

  @Get('reimbursements')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  listReimb(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('status') status?: ApprovalStatus,
  ) {
    return this.reimbursements.list(this.scope(user, req, branchId), status);
  }

  @Post('reimbursements')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  createReimb(
    @Body() dto: CreateReimbursementDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.reimbursements.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Post('reimbursements/:id/approve')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  approveReimb(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.reimbursements.setStatus(
      id,
      ApprovalStatus.Approved,
      user,
      this.scope(user, req),
    );
  }

  @Post('reimbursements/:id/reject')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  rejectReimb(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.reimbursements.setStatus(
      id,
      ApprovalStatus.Rejected,
      user,
      this.scope(user, req),
    );
  }

  @Patch('reimbursements/:id/status')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  setReimbStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReimbursementStatusDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.reimbursements.setStatus(
      id,
      dto.status,
      user,
      this.scope(user, req),
    );
  }
}
