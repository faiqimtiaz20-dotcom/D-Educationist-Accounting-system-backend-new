import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { TaxModule } from '../tax/tax.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AccountingModule, TaxModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
