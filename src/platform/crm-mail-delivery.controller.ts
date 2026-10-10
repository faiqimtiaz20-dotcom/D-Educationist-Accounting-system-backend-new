import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  CurrentUser,
  PlatformRoute,
  RequireRoles,
  type AuthUserPayload,
} from '../common/decorators';
import { ROLE_CODES } from '../common/rbac';
import { CloudwaysMailClient } from '../mail/cloudways-mail.client';
import {
  TestMailRelayDto,
  UpdateMailDeliveryDto,
} from './dto/mail-delivery.dto';
import { PlatformSettingsService } from './platform-settings.service';

@Controller('crm/mail-delivery')
@PlatformRoute()
@RequireRoles(ROLE_CODES.CRM_ADMIN)
export class CrmMailDeliveryController {
  constructor(
    private readonly platform: PlatformSettingsService,
    private readonly cloudways: CloudwaysMailClient,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return this.platform.getMailDeliveryPublic();
  }

  @Put()
  async update(
    @Body() dto: UpdateMailDeliveryDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    const before = await this.platform.getMailDeliveryPublic();
    const after = await this.platform.upsertMailDelivery(
      {
        mode: dto.mode,
        url: dto.url,
        apiKey: dto.apiKey,
      },
      user.id,
    );

    await this.audit.log({
      userId: user.id,
      tenantId: null,
      action: 'UPDATE',
      module: 'CRM',
      entityType: 'PlatformSetting',
      entityId: 'mail_delivery',
      beforeData: {
        mode: before.mode,
        url: before.url,
        apiKeyConfigured: before.apiKeyConfigured,
      },
      afterData: {
        mode: after.mode,
        url: after.url,
        apiKeyConfigured: after.apiKeyConfigured,
      },
    });

    return after;
  }

  /** Health ping against the configured Cloudways relay (no SMTP send). */
  @Post('ping')
  async ping() {
    const relay = await this.platform.resolveCloudwaysRelay();
    if (!relay.url || !relay.apiKey) {
      throw new BadRequestException(
        'Cloudways URL / API key not configured',
      );
    }
    return this.cloudways.ping(relay.url, relay.apiKey);
  }

  /**
   * Optional: send a relay self-test using the Cloudways API's own SMTP env
   * (not tenant config). Useful after deploy.
   */
  @Post('test')
  async test(
    @Body() dto: TestMailRelayDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    const relay = await this.platform.resolveCloudwaysRelay();
    if (!relay.url || !relay.apiKey) {
      throw new BadRequestException(
        'Cloudways URL / API key not configured',
      );
    }
    const result = await this.cloudways.sendRelaySelfTest({
      url: relay.url,
      apiKey: relay.apiKey,
      to: dto.to,
    });
    await this.audit.log({
      userId: user.id,
      tenantId: null,
      action: 'CREATE',
      module: 'CRM',
      entityType: 'PlatformSetting',
      entityId: 'mail_delivery_test',
      afterData: { to: dto.to, messageId: result.messageId },
    });
    return { success: true, ...result };
  }
}
