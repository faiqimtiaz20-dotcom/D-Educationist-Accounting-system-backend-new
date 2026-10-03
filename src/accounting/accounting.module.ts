import { Module } from '@nestjs/common';
import { GlPostingService } from './gl-posting.service';
import { FiscalLockService } from './fiscal-lock.service';
import { JournalsService } from './journals.service';
import { GlInquiryService } from './gl-inquiry.service';
import { PartyLedgersService } from './party-ledgers.service';
import { AccountingController } from './accounting.controller';

@Module({
  controllers: [AccountingController],
  providers: [
    GlPostingService,
    FiscalLockService,
    JournalsService,
    GlInquiryService,
    PartyLedgersService,
  ],
  exports: [GlPostingService, FiscalLockService, JournalsService, GlInquiryService],
})
export class AccountingModule {}
