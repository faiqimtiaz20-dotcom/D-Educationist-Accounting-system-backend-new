import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { RevenueController } from './revenue.controller';
import { InvoicesService } from './invoices.service';
import { OtherInvoicesService } from './other-invoices.service';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [AccountingModule, MailModule, SettingsModule],
  controllers: [RevenueController],
  providers: [InvoicesService, OtherInvoicesService, ReceivablesService],
  exports: [InvoicesService, OtherInvoicesService, ReceivablesService],
})
export class RevenueModule {}
