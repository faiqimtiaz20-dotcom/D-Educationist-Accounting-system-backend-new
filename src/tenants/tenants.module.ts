import { Global, Module } from '@nestjs/common';
import { TenantTemplateService } from './tenant-template.service';
import { CrmTenantsService } from './crm-tenants.service';
import { CrmTenantsController } from './crm-tenants.controller';

@Global()
@Module({
  controllers: [CrmTenantsController],
  providers: [TenantTemplateService, CrmTenantsService],
  exports: [TenantTemplateService, CrmTenantsService],
})
export class TenantsModule {}
