import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MastersController } from './masters.controller';
import { MastersService } from './masters.service';

@Module({
  imports: [AccountingModule],
  controllers: [MastersController],
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
