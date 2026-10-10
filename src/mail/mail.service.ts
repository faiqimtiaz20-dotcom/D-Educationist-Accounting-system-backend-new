import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SmtpAuthMode, SmtpProvider } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { currentTenantId } from '../common/tenant-scope';
import { TenantContext } from '../common/tenant-context';
import { decryptSecret, encryptSecret } from './crypto-secret';
import {
  GOOGLE_AUTH_URL,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  MS_AUTH_URL,
  MS_SCOPES,
  MS_TOKEN_URL,
  MS_USERINFO_URL,
  smtpPreset,
} from './smtp-presets';
import {
  TestEmailDto,
  UpsertSmtpPasswordDto,
} from './dto/mail.dto';
import { preferIpv4Transport } from './smtp-ipv4';
import {
  CloudwaysMailClient,
  type CloudwaysTransportPayload,
} from './cloudways-mail.client';
import { PlatformSettingsService } from '../platform/platform-settings.service';

type OauthStatePayload = {
  purpose: 'smtp_oauth';
  tenantId: string;
  userId: string;
  provider: SmtpProvider;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly platform: PlatformSettingsService,
    private readonly cloudways: CloudwaysMailClient,
  ) {}

  private publicApiBase() {
    return (
      this.config.get<string>('PUBLIC_API_URL') ||
      `http://127.0.0.1:${this.config.get('PORT') || 3001}/api/v1`
    ).replace(/\/$/, '');
  }

  private spaBase() {
    return (
      this.config.get<string>('SPA_URL') ||
      this.config.get<string>('CORS_ORIGIN')?.split(',')[0]?.trim() ||
      'http://localhost:5173'
    ).replace(/\/$/, '');
  }

  private oauthCallbackUrl() {
    return `${this.publicApiBase()}/settings/email/oauth/callback`;
  }

  private googleCreds() {
    const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');
    return { clientId, clientSecret };
  }

  private msCreds() {
    const clientId = this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID');
    const clientSecret = this.config.get<string>(
      'MICROSOFT_OAUTH_CLIENT_SECRET',
    );
    return { clientId, clientSecret };
  }

  oauthProvidersStatus() {
    const g = this.googleCreds();
    const m = this.msCreds();
    return {
      gmail: Boolean(g.clientId && g.clientSecret),
      microsoft365: Boolean(m.clientId && m.clientSecret),
      outlook: Boolean(m.clientId && m.clientSecret),
      callbackUrl: this.oauthCallbackUrl(),
    };
  }

  async getStatus() {
    const tenantId = currentTenantId();
    const row = await this.prisma.tenantSmtpConfig.findUnique({
      where: { tenantId },
    });
    if (!row) {
      return {
        configured: false,
        connected: false,
        provider: null,
        authMode: null,
        fromEmail: null,
        fromName: null,
        host: null,
        port: null,
        secure: true,
        username: null,
        oauthEmail: null,
        hasPassword: false,
        connectedAt: null,
        lastTestAt: null,
        lastTestOk: null,
        lastError: null,
        oauth: this.oauthProvidersStatus(),
      };
    }
    return {
      configured: true,
      connected:
        row.authMode === 'OAUTH'
          ? Boolean(row.oauthRefreshTokenEnc)
          : Boolean(row.passwordEnc || row.username),
      provider: row.provider,
      authMode: row.authMode,
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      oauthEmail: row.oauthEmail,
      hasPassword: Boolean(row.passwordEnc),
      connectedAt: row.connectedAt?.toISOString() ?? null,
      lastTestAt: row.lastTestAt?.toISOString() ?? null,
      lastTestOk: row.lastTestOk,
      lastError: row.lastError,
      oauth: this.oauthProvidersStatus(),
    };
  }

  async upsertPassword(dto: UpsertSmtpPasswordDto, actorId: string) {
    const tenantId = currentTenantId();
    const preset = smtpPreset(dto.provider);
    const host = dto.host?.trim() || preset?.host;
    const port = dto.port ?? preset?.port ?? 587;
    const secure = dto.secure ?? preset?.secure ?? port === 465;
    if (!host) {
      throw new BadRequestException('SMTP host is required for CUSTOM provider');
    }

    const existing = await this.prisma.tenantSmtpConfig.findUnique({
      where: { tenantId },
    });
    let passwordEnc = existing?.passwordEnc ?? null;
    if (dto.password !== undefined && dto.password !== '') {
      passwordEnc = encryptSecret(this.config, dto.password);
    }
    if (!passwordEnc && !existing?.passwordEnc) {
      throw new BadRequestException('SMTP password / app password is required');
    }

    const data = {
      provider: dto.provider,
      authMode: SmtpAuthMode.PASSWORD,
      fromEmail: dto.fromEmail.trim().toLowerCase(),
      fromName: dto.fromName?.trim() || null,
      host,
      port,
      secure,
      username: (dto.username?.trim() || dto.fromEmail.trim()).toLowerCase(),
      passwordEnc: passwordEnc!,
      oauthAccessTokenEnc: null,
      oauthRefreshTokenEnc: null,
      oauthExpiresAt: null,
      oauthEmail: null,
      connectedAt: new Date(),
      lastError: null,
    };

    const row = await this.prisma.tenantSmtpConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'TenantSmtpConfig',
      entityId: row.id,
      afterData: {
        provider: row.provider,
        authMode: row.authMode,
        fromEmail: row.fromEmail,
        host: row.host,
      },
    });

    return this.getStatus();
  }

  async startOauth(provider: SmtpProvider, userId: string) {
    if (provider === 'CUSTOM') {
      throw new BadRequestException('OAuth is only for Gmail / Outlook / M365');
    }
    const tenantId = currentTenantId();
    const state = await this.jwt.signAsync(
      {
        purpose: 'smtp_oauth',
        tenantId,
        userId,
        provider,
      } satisfies OauthStatePayload,
      {
        secret:
          this.config.get<string>('JWT_ACCESS_SECRET') ||
          'dev-only-access-secret',
        expiresIn: '15m',
      },
    );

    const redirectUri = this.oauthCallbackUrl();
    if (provider === 'GMAIL') {
      const { clientId, clientSecret } = this.googleCreds();
      if (!clientId || !clientSecret) {
        throw new ServiceUnavailableException(
          'Gmail OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET',
        );
      }
      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', GOOGLE_SCOPES);
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
      return { url: url.toString(), provider };
    }

    const { clientId, clientSecret } = this.msCreds();
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'Microsoft OAuth not configured — set MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET',
      );
    }
    const url = new URL(MS_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', MS_SCOPES);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('state', state);
    return { url: url.toString(), provider };
  }

  async handleOauthCallback(code: string, state: string) {
    let payload: OauthStatePayload;
    try {
      payload = await this.jwt.verifyAsync<OauthStatePayload>(state, {
        secret:
          this.config.get<string>('JWT_ACCESS_SECRET') ||
          'dev-only-access-secret',
      });
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    if (payload.purpose !== 'smtp_oauth') {
      throw new BadRequestException('Invalid OAuth state');
    }

    TenantContext.enter({ tenantId: payload.tenantId, isPlatform: false });

    const redirectUri = this.oauthCallbackUrl();
    let accessToken = '';
    let refreshToken = '';
    let expiresAt: Date | null = null;
    let email = '';

    if (payload.provider === 'GMAIL') {
      const { clientId, clientSecret } = this.googleCreds();
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new BadRequestException(
          tokenJson.error_description ||
            tokenJson.error ||
            'Google token exchange failed',
        );
      }
      accessToken = tokenJson.access_token;
      refreshToken = tokenJson.refresh_token || '';
      if (tokenJson.expires_in) {
        expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000);
      }
      const meRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = (await meRes.json()) as { email?: string };
      email = (me.email || '').toLowerCase();
    } else {
      const { clientId, clientSecret } = this.msCreds();
      const tokenRes = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: MS_SCOPES,
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new BadRequestException(
          tokenJson.error_description ||
            tokenJson.error ||
            'Microsoft token exchange failed',
        );
      }
      accessToken = tokenJson.access_token;
      refreshToken = tokenJson.refresh_token || '';
      if (tokenJson.expires_in) {
        expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000);
      }
      const meRes = await fetch(MS_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = (await meRes.json()) as {
        mail?: string;
        userPrincipalName?: string;
      };
      email = (me.mail || me.userPrincipalName || '').toLowerCase();
    }

    if (!email) {
      throw new BadRequestException('Could not read email from provider profile');
    }

    const existing = await this.prisma.tenantSmtpConfig.findUnique({
      where: { tenantId: payload.tenantId },
    });
    if (!refreshToken && existing?.oauthRefreshTokenEnc) {
      refreshToken = decryptSecret(this.config, existing.oauthRefreshTokenEnc) || '';
    }
    if (!refreshToken) {
      throw new BadRequestException(
        'No refresh token returned — revoke app access and connect again with consent',
      );
    }

    const preset = smtpPreset(payload.provider)!;
    const data = {
      provider: payload.provider,
      authMode: SmtpAuthMode.OAUTH,
      fromEmail: email,
      fromName: existing?.fromName ?? null,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
      username: email,
      passwordEnc: null,
      oauthAccessTokenEnc: encryptSecret(this.config, accessToken),
      oauthRefreshTokenEnc: encryptSecret(this.config, refreshToken),
      oauthExpiresAt: expiresAt,
      oauthEmail: email,
      connectedAt: new Date(),
      lastError: null,
    };

    await this.prisma.tenantSmtpConfig.upsert({
      where: { tenantId: payload.tenantId },
      create: { tenantId: payload.tenantId, ...data },
      update: data,
    });

    await this.audit.log({
      userId: payload.userId,
      tenantId: payload.tenantId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'TenantSmtpConfig',
      afterData: {
        provider: payload.provider,
        authMode: 'OAUTH',
        oauthEmail: email,
      },
    });

    return `${this.spaBase()}/settings/email?connected=1&provider=${payload.provider}`;
  }

  async disconnect(actorId: string) {
    const tenantId = currentTenantId();
    const row = await this.prisma.tenantSmtpConfig.findUnique({
      where: { tenantId },
    });
    if (!row) return { success: true };
    await this.prisma.tenantSmtpConfig.delete({ where: { tenantId } });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'TenantSmtpConfig',
      entityId: row.id,
      beforeData: { provider: row.provider, fromEmail: row.fromEmail },
    });
    return { success: true };
  }

  private async refreshOauthIfNeeded(row: {
    id: string;
    provider: SmtpProvider;
    oauthAccessTokenEnc: string | null;
    oauthRefreshTokenEnc: string | null;
    oauthExpiresAt: Date | null;
  }) {
    const refresh = decryptSecret(this.config, row.oauthRefreshTokenEnc);
    if (!refresh) throw new BadRequestException('OAuth not connected');

    const stillValid =
      row.oauthExpiresAt &&
      row.oauthExpiresAt.getTime() > Date.now() + 60_000 &&
      row.oauthAccessTokenEnc;
    if (stillValid) {
      return decryptSecret(this.config, row.oauthAccessTokenEnc)!;
    }

    if (row.provider === 'GMAIL') {
      const { clientId, clientSecret } = this.googleCreds();
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new BadRequestException('Gmail token refresh failed — reconnect');
      }
      await this.prisma.tenantSmtpConfig.update({
        where: { id: row.id },
        data: {
          oauthAccessTokenEnc: encryptSecret(
            this.config,
            tokenJson.access_token,
          ),
          oauthExpiresAt: tokenJson.expires_in
            ? new Date(Date.now() + tokenJson.expires_in * 1000)
            : null,
        },
      });
      return tokenJson.access_token;
    }

    const { clientId, clientSecret } = this.msCreds();
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        refresh_token: refresh,
        grant_type: 'refresh_token',
        scope: MS_SCOPES,
      }),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new BadRequestException(
        'Microsoft token refresh failed — reconnect',
      );
    }
    await this.prisma.tenantSmtpConfig.update({
      where: { id: row.id },
      data: {
        oauthAccessTokenEnc: encryptSecret(this.config, tokenJson.access_token),
        ...(tokenJson.refresh_token
          ? {
              oauthRefreshTokenEnc: encryptSecret(
                this.config,
                tokenJson.refresh_token,
              ),
            }
          : {}),
        oauthExpiresAt: tokenJson.expires_in
          ? new Date(Date.now() + tokenJson.expires_in * 1000)
          : null,
      },
    });
    return tokenJson.access_token;
  }

  private async recordTestResult(
    tenantId: string,
    ok: boolean,
    error?: string,
  ) {
    try {
      // Prefer unique tenantId key (avoids fragile id+tenant compound where)
      await this.prisma.tenantSmtpConfig.update({
        where: { tenantId },
        data: {
          lastTestAt: new Date(),
          lastTestOk: ok,
          lastError: ok ? null : (error ?? 'Send failed').slice(0, 500),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist email test result: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async buildTransport(tenantId?: string) {
    const tid = tenantId || currentTenantId();
    const row = await this.prisma.tenantSmtpConfig.findUnique({
      where: { tenantId: tid },
    });
    if (!row) {
      throw new NotFoundException(
        'Email not configured for this organisation — Settings → Email',
      );
    }

    const from = row.fromEmail || row.oauthEmail || row.username;
    if (!from) throw new BadRequestException('From email missing');

    let transportOpts: SMTPTransport.Options;

    if (row.authMode === 'OAUTH') {
      const accessToken = await this.refreshOauthIfNeeded(row);
      const refreshToken = decryptSecret(this.config, row.oauthRefreshTokenEnc);
      if (!refreshToken) {
        throw new BadRequestException(
          'OAuth credentials cannot be decrypted — reconnect email (SMTP_SECRET may have changed)',
        );
      }
      if (row.provider === 'GMAIL') {
        const { clientId, clientSecret } = this.googleCreds();
        if (!clientId || !clientSecret) {
          throw new ServiceUnavailableException(
            'Gmail OAuth is not configured on the server',
          );
        }
        transportOpts = {
          service: 'gmail',
          auth: {
            type: 'OAuth2',
            user: from,
            clientId,
            clientSecret,
            refreshToken,
            accessToken,
          },
        };
      } else {
        const { clientId, clientSecret } = this.msCreds();
        if (!clientId || !clientSecret) {
          throw new ServiceUnavailableException(
            'Microsoft OAuth is not configured on the server',
          );
        }
        transportOpts = {
          host: row.host || 'smtp.office365.com',
          port: row.port || 587,
          secure: false,
          auth: {
            type: 'OAuth2',
            user: from,
            clientId,
            clientSecret,
            refreshToken,
            accessToken,
          },
        };
      }
    } else {
      const password = decryptSecret(this.config, row.passwordEnc);
      if (!password) {
        throw new BadRequestException(
          'SMTP password missing or cannot be decrypted — re-save the password in Settings → Email (SMTP_SECRET may have changed)',
        );
      }
      if (!row.host) {
        throw new BadRequestException(
          'SMTP host is missing — re-save email settings',
        );
      }
      transportOpts = {
        host: row.host,
        port: row.port || 587,
        secure: row.secure,
        auth: {
          user: row.username || from,
          pass: password,
        },
      };
    }

    transportOpts = await preferIpv4Transport(transportOpts);
    const transporter = nodemailer.createTransport(transportOpts);
    return {
      transporter,
      from: row.fromName ? `"${row.fromName}" <${from}>` : from,
      row,
      tenantId: tid,
    };
  }

  private formatSendError(message: string): string {
    if (/ENETUNREACH|EHOSTUNREACH/i.test(message) && /[a-f0-9:]{2,}/i.test(message)) {
      return `${message} — the server tried IPv6 but this host (e.g. Railway) may only support outbound IPv4. Redeploy with the latest API build (SMTP_FORCE_IPV4) or use a relay that offers IPv4.`;
    }
    return message;
  }

  /** Build Cloudways relay transport from the same tenant SMTP/OAuth row. */
  private async buildCloudwaysTransport(tenantId?: string): Promise<{
    tenantId: string;
    fromEmail: string;
    fromName: string | null;
    fromHeader: string;
    transport: CloudwaysTransportPayload;
  }> {
    const tid = tenantId || currentTenantId();
    const row = await this.prisma.tenantSmtpConfig.findUnique({
      where: { tenantId: tid },
    });
    if (!row) {
      throw new NotFoundException(
        'Email not configured for this organisation — Settings → Email',
      );
    }
    const fromEmail = row.fromEmail || row.oauthEmail || row.username;
    if (!fromEmail) throw new BadRequestException('From email missing');

    if (row.authMode === 'OAUTH') {
      const accessToken = await this.refreshOauthIfNeeded(row);
      const refreshToken = decryptSecret(this.config, row.oauthRefreshTokenEnc);
      if (!refreshToken) {
        throw new BadRequestException(
          'OAuth credentials cannot be decrypted — reconnect email (SMTP_SECRET may have changed)',
        );
      }
      const isGmail = row.provider === 'GMAIL';
      const creds = isGmail ? this.googleCreds() : this.msCreds();
      if (!creds.clientId || !creds.clientSecret) {
        throw new ServiceUnavailableException(
          isGmail
            ? 'Gmail OAuth is not configured on the server'
            : 'Microsoft OAuth is not configured on the server',
        );
      }
      const host =
        row.host ||
        (isGmail ? 'smtp.gmail.com' : 'smtp.office365.com');
      const port = row.port || (isGmail ? 465 : 587);
      const secure = isGmail ? true : Boolean(row.secure);
      return {
        tenantId: tid,
        fromEmail,
        fromName: row.fromName,
        fromHeader: row.fromName
          ? `"${row.fromName}" <${fromEmail}>`
          : fromEmail,
        transport: {
          provider: row.provider,
          authMode: 'OAUTH',
          host,
          port,
          secure,
          username: fromEmail,
          oauth: {
            accessToken,
            refreshToken,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            user: fromEmail,
          },
        },
      };
    }

    const password = decryptSecret(this.config, row.passwordEnc);
    if (!password) {
      throw new BadRequestException(
        'SMTP password missing or cannot be decrypted — re-save the password in Settings → Email (SMTP_SECRET may have changed)',
      );
    }
    if (!row.host) {
      throw new BadRequestException(
        'SMTP host is missing — re-save email settings',
      );
    }
    return {
      tenantId: tid,
      fromEmail,
      fromName: row.fromName,
      fromHeader: row.fromName
        ? `"${row.fromName}" <${fromEmail}>`
        : fromEmail,
      transport: {
        provider: row.provider,
        authMode: 'PASSWORD',
        host: row.host,
        port: row.port || 587,
        secure: row.secure,
        username: row.username || fromEmail,
        password,
      },
    };
  }

  private toCloudwaysAttachments(
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
      cid?: string;
    }>,
  ) {
    if (!attachments?.length) return undefined;
    return attachments.map((a) => ({
      filename: a.filename,
      contentBase64: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(a.content).toString('base64'),
      contentType: a.contentType,
      cid: a.cid,
    }));
  }

  async sendMail(input: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    cc?: string;
    tenantId?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
      cid?: string;
    }>;
  }) {
    const relay = await this.platform.resolveCloudwaysRelay();
    if (relay.mode === 'cloudways') {
      if (!relay.url || !relay.apiKey) {
        throw new ServiceUnavailableException(
          'Cloudways mail relay is enabled but URL/API key is missing — CRM → Email delivery',
        );
      }
      const built = await this.buildCloudwaysTransport(input.tenantId);
      try {
        const info = await this.cloudways.send({
          url: relay.url,
          apiKey: relay.apiKey,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          cc: input.cc,
          from: { email: built.fromEmail, name: built.fromName },
          transport: built.transport,
          attachments: this.toCloudwaysAttachments(input.attachments),
        });
        await this.recordTestResult(built.tenantId, true);
        return { messageId: info.messageId, accepted: info.accepted };
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException ||
          err instanceof ServiceUnavailableException
        ) {
          const msg =
            err instanceof BadRequestException
              ? String(
                  (err.getResponse() as { message?: string })?.message ||
                    err.message,
                )
              : err.message;
          await this.recordTestResult(built.tenantId, false, msg);
          throw err;
        }
        const raw = err instanceof Error ? err.message : String(err);
        const message = this.formatSendError(raw);
        this.logger.warn(`sendMail (cloudways) failed: ${raw}`);
        await this.recordTestResult(built.tenantId, false, message);
        throw new BadRequestException(`Email send failed: ${message}`);
      }
    }

    const { transporter, from, tenantId } = await this.buildTransport(
      input.tenantId,
    );
    try {
      const info = await transporter.sendMail({
        from,
        to: input.to,
        cc: input.cc || undefined,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments,
      });
      await this.recordTestResult(tenantId, true);
      return { messageId: info.messageId, accepted: info.accepted };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const raw = err instanceof Error ? err.message : String(err);
      const message = this.formatSendError(raw);
      this.logger.warn(`sendMail failed: ${raw}`);
      await this.recordTestResult(tenantId, false, message);
      throw new BadRequestException(`Email send failed: ${message}`);
    }
  }

  async sendTest(dto: TestEmailDto, actorId: string) {
    try {
      const result = await this.sendMail({
        to: dto.to,
        subject: dto.subject || "Test email — D' Educationist Accounting",
        text:
          dto.body ||
          'This is a test message from your organisation SMTP / OAuth settings.',
      });
      try {
        await this.audit.log({
          userId: actorId,
          action: 'CREATE',
          module: 'Settings',
          entityType: 'TenantSmtpConfig',
          afterData: { testTo: dto.to, messageId: result.messageId },
        });
      } catch (err) {
        this.logger.warn(
          `Audit log for email test failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return { success: true, ...result, status: await this.getStatus() };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`sendTest unexpected error: ${message}`);
      throw new BadRequestException(`Email test failed: ${message}`);
    }
  }
}
