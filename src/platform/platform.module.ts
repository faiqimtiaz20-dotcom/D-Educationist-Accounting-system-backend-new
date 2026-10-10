import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CloudwaysMailClient } from '../mail/cloudways-mail.client';
import { CrmMailDeliveryController } from './crm-mail-delivery.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [CrmMailDeliveryController],
  providers: [PlatformSettingsService, CloudwaysMailClient],
  exports: [PlatformSettingsService, CloudwaysMailClient],
})
export class PlatformModule {}
