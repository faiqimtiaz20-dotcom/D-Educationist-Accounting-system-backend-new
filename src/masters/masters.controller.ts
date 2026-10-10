import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { MastersService } from './masters.service';
import {
  CreateBankAccountDto,
  CreateCategoryDto,
  CreateCourseDto,
  CreateGlAccountDto,
  CreateSubAgentDto,
  CreateTenantCountryDto,
  CreateUniversityDto,
  CreateVendorDto,
  UpdateBankAccountDto,
  UpdateCategoryDto,
  UpdateCourseDto,
  UpdateCurrencyDto,
  UpdateSubAgentDto,
  UpdateTenantCountryDto,
  UpdateUniversityDto,
  UpdateVendorDto,
  UpsertFxRateDto,
} from './dto/masters.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Universities (JWT for list; Settings full to mutate) ──────────────────

  @Get('universities')
  listUniversities(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listUniversities(includeInactive === 'true');
  }

  @Get('universities/:id')
  getUniversity(@Param('id') id: string) {
    return this.masters.getUniversity(id);
  }

  @Post('universities')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  createUniversity(
    @Body() dto: CreateUniversityDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createUniversity(dto, user.id);
  }

  @Patch('universities/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updateUniversity(
    @Param('id') id: string,
    @Body() dto: UpdateUniversityDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateUniversity(id, dto, user.id);
  }

  @Delete('universities/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  deleteUniversity(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.deleteUniversity(id, user.id);
  }

  // ── Courses (Settings master) ─────────────────────────────────────────────

  @Get('courses')
  listCourses(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listCourses(includeInactive === 'true');
  }

  @Get('courses/:id')
  getCourse(@Param('id') id: string) {
    return this.masters.getCourse(id);
  }

  @Post('courses')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  createCourse(
    @Body() dto: CreateCourseDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createCourse(dto, user.id);
  }

  @Patch('courses/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updateCourse(
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateCourse(id, dto, user.id);
  }

  @Delete('courses/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  deleteCourse(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.deleteCourse(id, user.id);
  }

  // ── Destination countries (tenant Settings master) ────────────────────────

  @Get('countries')
  listCountries(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listTenantCountries(includeInactive === 'true');
  }

  @Get('countries/:id')
  getCountry(@Param('id') id: string) {
    return this.masters.getTenantCountry(id);
  }

  @Post('countries')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  createCountry(
    @Body() dto: CreateTenantCountryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createTenantCountry(dto, user.id);
  }

  @Patch('countries/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updateCountry(
    @Param('id') id: string,
    @Body() dto: UpdateTenantCountryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateTenantCountry(id, dto, user.id);
  }

  @Delete('countries/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  deleteCountry(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.deleteTenantCountry(id, user.id);
  }

  // ── Sub-agents ────────────────────────────────────────────────────────────

  @Get('sub-agents')
  listSubAgents(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listSubAgents(includeInactive === 'true');
  }

  @Get('sub-agents/:id')
  getSubAgent(@Param('id') id: string) {
    return this.masters.getSubAgent(id);
  }

  @Post('sub-agents')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  createSubAgent(
    @Body() dto: CreateSubAgentDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createSubAgent(dto, user.id);
  }

  @Patch('sub-agents/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  updateSubAgent(
    @Param('id') id: string,
    @Body() dto: UpdateSubAgentDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateSubAgent(id, dto, user.id);
  }

  @Delete('sub-agents/:id')
  @RequirePermission(MODULE_CODES.SUB_AGENTS_PAYABLES, 'full')
  deleteSubAgent(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.deleteSubAgent(id, user.id);
  }

  // ── Vendors ───────────────────────────────────────────────────────────────

  @Get('vendors')
  listVendors(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listVendors(includeInactive === 'true');
  }

  @Get('vendors/:id')
  getVendor(@Param('id') id: string) {
    return this.masters.getVendor(id);
  }

  @Post('vendors')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  createVendor(
    @Body() dto: CreateVendorDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createVendor(dto, user.id);
  }

  @Patch('vendors/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  updateVendor(
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateVendor(id, dto, user.id);
  }

  @Delete('vendors/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  deleteVendor(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.masters.deleteVendor(id, user.id);
  }

  // ── Bank accounts ─────────────────────────────────────────────────────────

  @Get('bank-accounts')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'read')
  listBankAccounts(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.masters.listBankAccounts(
      this.scope(user, req, branchId),
      includeInactive === 'true',
    );
  }

  @Get('bank-accounts/:id')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'read')
  getBankAccount(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.masters.getBankAccount(id, this.scope(user, req, branchId));
  }

  @Post('bank-accounts')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  createBankAccount(
    @Body() dto: CreateBankAccountDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createBankAccount(dto, user.id);
  }

  @Patch('bank-accounts/:id')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  updateBankAccount(
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.masters.updateBankAccount(
      id,
      dto,
      user.id,
      this.scope(user, req),
    );
  }

  @Delete('bank-accounts/:id')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  deleteBankAccount(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.masters.deleteBankAccount(id, user.id, this.scope(user, req));
  }

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('expense-categories')
  listExpenseCategories(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listExpenseCategories(includeInactive === 'true');
  }

  @Post('expense-categories')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  createExpenseCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createExpenseCategory(dto, user.id);
  }

  @Patch('expense-categories/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updateExpenseCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateExpenseCategory(id, dto, user.id);
  }

  @Delete('expense-categories/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  deleteExpenseCategory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.deleteExpenseCategory(id, user.id);
  }

  @Get('petty-cash-categories')
  listPettyCashCategories(@Query('includeInactive') includeInactive?: string) {
    return this.masters.listPettyCashCategories(includeInactive === 'true');
  }

  @Post('petty-cash-categories')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  createPettyCashCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createPettyCashCategory(dto, user.id);
  }

  @Patch('petty-cash-categories/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updatePettyCashCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updatePettyCashCategory(id, dto, user.id);
  }

  @Delete('petty-cash-categories/:id')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  deletePettyCashCategory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.deletePettyCashCategory(id, user.id);
  }

  // ── Currencies / FX / COA ─────────────────────────────────────────────────

  @Get('currencies')
  listCurrencies(@Query('enabledOnly') enabledOnly?: string) {
    return this.masters.listCurrencies(enabledOnly === 'true');
  }

  @Patch('currencies/:code')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  updateCurrency(
    @Param('code') code: string,
    @Body() dto: UpdateCurrencyDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.updateCurrency(code, dto, user.id);
  }

  @Get('fx-rates')
  listFxRates() {
    return this.masters.listFxRates();
  }

  @Put('fx-rates')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  upsertFxRate(
    @Body() dto: UpsertFxRateDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.upsertFxRate(dto, user.id);
  }

  @Get('gl-accounts')
  listGlAccounts() {
    return this.masters.listGlAccounts();
  }

  @Post('gl-accounts')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  createGlAccount(
    @Body() dto: CreateGlAccountDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.masters.createGlAccount(dto, user.id);
  }

  @Post('gl-accounts/seed')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  seedGlAccounts(@CurrentUser() user: AuthUserPayload) {
    return this.masters.seedChartOfAccounts(user.id);
  }
}