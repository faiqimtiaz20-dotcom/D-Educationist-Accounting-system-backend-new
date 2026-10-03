import { Global, Module } from '@nestjs/common';
import { ApprovalsSyncService } from './approvals-sync.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Global()
@Module({
  imports: [NotificationsModule],
  providers: [ApprovalsSyncService],
  exports: [ApprovalsSyncService],
})
export class ApprovalsSyncModule {}
