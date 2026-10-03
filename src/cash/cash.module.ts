import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CashController } from './cash.controller';
import { PettyCashService } from './petty-cash.service';
import { ExpensesService } from './expenses.service';
import { BankService } from './bank.service';
import { ContraService } from './contra.service';

@Module({
  imports: [AccountingModule],
  controllers: [CashController],
  providers: [PettyCashService, ExpensesService, BankService, ContraService],
  exports: [PettyCashService, ExpensesService, BankService, ContraService],
})
export class CashModule {}
