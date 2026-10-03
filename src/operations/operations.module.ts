import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PayrollModule } from '../payroll/payroll.module';
import { OperationsController } from './operations.controller';
import { ApprovalsService } from './approvals.service';
import { DocumentsService } from './documents.service';
import { AuditQueryService } from './audit-query.service';

@Module({
  imports: [CashModule, AccountingModule, PayrollModule],
  controllers: [OperationsController],
  providers: [ApprovalsService, DocumentsService, AuditQueryService],
  exports: [ApprovalsService, DocumentsService, AuditQueryService],
})
export class OperationsModule {}
