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
import { PettyCashService } from './petty-cash.service';
import { ExpensesService } from './expenses.service';
import { BankService } from './bank.service';
import { ContraService } from './contra.service';
import {
  CreateBankTxnDto,
  CreateChequeDto,
  CreateContraDto,
  CreateExpenseDto,
  CreatePettyCashDto,
  UpdateBankTxnDto,
  UpdateChequeStatusDto,
  UpdateExpenseDto,
  UpdatePettyCashDto,
} from './dto/cash.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class CashController {
  constructor(
    private readonly pettyCash: PettyCashService,
    private readonly expenses: ExpensesService,
    private readonly bank: BankService,
    private readonly contra: ContraService,
  ) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Petty cash ────────────────────────────────────────────────────────────

  @Get('petty-cash')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'read')
  listPetty(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.pettyCash.list(this.scope(user, req, branchId));
  }

  @Get('petty-cash/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'read')
  getPetty(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.pettyCash.get(id, this.scope(user, req));
  }

  @Post('petty-cash')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  createPetty(
    @Body() dto: CreatePettyCashDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.pettyCash.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('petty-cash/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  updatePetty(
    @Param('id') id: string,
    @Body() dto: UpdatePettyCashDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.pettyCash.update(id, dto, user, this.scope(user, req));
  }

  @Delete('petty-cash/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  deletePetty(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.pettyCash.remove(id, user, this.scope(user, req));
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  @Get('expenses')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'read')
  listExpenses(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.expenses.list(this.scope(user, req, branchId));
  }

  @Get('expenses/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'read')
  getExpense(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.expenses.get(id, this.scope(user, req));
  }

  @Post('expenses')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  createExpense(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.expenses.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('expenses/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  updateExpense(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.expenses.update(id, dto, user, this.scope(user, req));
  }

  @Post('expenses/:id/approve')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  approveExpense(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.expenses.approve(id, user, this.scope(user, req));
  }

  @Post('expenses/:id/reject')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  rejectExpense(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.expenses.reject(id, user, this.scope(user, req));
  }

  @Delete('expenses/:id')
  @RequirePermission(MODULE_CODES.EXPENSES_PETTY_CASH, 'full')
  deleteExpense(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.expenses.remove(id, user, this.scope(user, req));
  }

  // ── Bank accounts / transactions / cheques ────────────────────────────────

  @Get('bank-accounts-balances')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'read')
  listBankBalances(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.bank.listAccounts(this.scope(user, req, branchId));
  }

  @Get('bank-transactions')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'read')
  listBankTxns(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.bank.listTransactions(
      this.scope(user, req, branchId),
      bankAccountId,
    );
  }

  @Post('bank-transactions')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  createBankTxn(
    @Body() dto: CreateBankTxnDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.bank.createTransaction(dto, user, this.scope(user, req));
  }

  @Patch('bank-transactions/:id')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  updateBankTxn(
    @Param('id') id: string,
    @Body() dto: UpdateBankTxnDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.bank.updateTransaction(id, dto, user, this.scope(user, req));
  }

  @Get('cheques')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'read')
  listCheques(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.bank.listCheques(this.scope(user, req, branchId));
  }

  @Post('cheques')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  createCheque(
    @Body() dto: CreateChequeDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.bank.createCheque(dto, user, this.scope(user, req));
  }

  @Patch('cheques/:id/status')
  @RequirePermission(MODULE_CODES.BANK_CASH, 'full')
  updateChequeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateChequeStatusDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.bank.updateChequeStatus(id, dto, user, this.scope(user, req));
  }

  // ── Contra ────────────────────────────────────────────────────────────────

  @Get('contra-entries')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'read')
  listContra(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.contra.list(this.scope(user, req, branchId));
  }

  @Post('contra-entries')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'full')
  createContra(
    @Body() dto: CreateContraDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.contra.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }
}
