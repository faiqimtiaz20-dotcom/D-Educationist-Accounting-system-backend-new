import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PayablesController } from './payables.controller';
import { CommissionsService } from './commissions.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AccountingModule],
  controllers: [PayablesController],
  providers: [CommissionsService, PaymentsService],
  exports: [CommissionsService, PaymentsService],
})
export class PayablesModule {}
