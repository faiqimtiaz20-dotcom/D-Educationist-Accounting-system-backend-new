import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MailService } from './mail.service';
import {
  StartOauthDto,
  TestEmailDto,
  UpsertSmtpPasswordDto,
} from './dto/mail.dto';
import {
  CurrentUser,
  Public,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { SmtpProvider } from '@prisma/client';

@Controller('settings/email')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  @RequirePermission(MODULE_CODES.SETTINGS, 'read')
  status() {
    return this.mail.getStatus();
  }

  @Post('password')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  savePassword(
    @Body() dto: UpsertSmtpPasswordDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.mail.upsertPassword(dto, user.id);
  }

  @Post('oauth/start')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  startOauth(
    @Body() dto: StartOauthDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.mail.startOauth(dto.provider, user.id);
  }

  /** Browser redirect from Google / Microsoft — no JWT. */
  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const spa =
      process.env.SPA_URL ||
      process.env.CORS_ORIGIN?.split(',')[0]?.trim() ||
      'http://localhost:5173';
    if (error) {
      const msg = encodeURIComponent(errorDescription || error);
      return res.redirect(`${spa}/settings/email?error=${msg}`);
    }
    if (!code || !state) {
      return res.redirect(
        `${spa}/settings/email?error=${encodeURIComponent('Missing OAuth code')}`,
      );
    }
    try {
      const url = await this.mail.handleOauthCallback(code, state);
      return res.redirect(url);
    } catch (err) {
      const msg = encodeURIComponent(
        err instanceof Error ? err.message : 'OAuth failed',
      );
      return res.redirect(`${spa}/settings/email?error=${msg}`);
    }
  }

  @Post('test')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  test(@Body() dto: TestEmailDto, @CurrentUser() user: AuthUserPayload) {
    return this.mail.sendTest(dto, user.id);
  }

  @Delete()
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  disconnect(@CurrentUser() user: AuthUserPayload) {
    return this.mail.disconnect(user.id);
  }

  /** Convenience: list supported one-click providers. */
  @Get('providers')
  @RequirePermission(MODULE_CODES.SETTINGS, 'read')
  providers() {
    return {
      providers: [
        SmtpProvider.GMAIL,
        SmtpProvider.MICROSOFT365,
        SmtpProvider.OUTLOOK,
        SmtpProvider.CUSTOM,
      ],
      oauth: this.mail.oauthProvidersStatus(),
    };
  }
}
