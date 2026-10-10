import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../mail/crypto-secret';
import {
  DEFAULT_MAIL_DELIVERY,
  MAIL_DELIVERY_KEY,
  type MailDeliveryMode,
  type MailDeliveryPublic,
  type MailDeliveryStored,
} from './mail-delivery.types';

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private parseMailDelivery(value: unknown): MailDeliveryStored {
    if (!value || typeof value !== 'object') return { ...DEFAULT_MAIL_DELIVERY };
    const v = value as Record<string, unknown>;
    const mode: MailDeliveryMode =
      v.mode === 'cloudways' ? 'cloudways' : 'direct';
    return {
      mode,
      url: typeof v.url === 'string' && v.url.trim() ? v.url.trim() : null,
      apiKeyEnc:
        typeof v.apiKeyEnc === 'string' && v.apiKeyEnc ? v.apiKeyEnc : null,
    };
  }

  async getMailDeliveryStored(): Promise<MailDeliveryStored> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: MAIL_DELIVERY_KEY },
    });
    if (!row) return { ...DEFAULT_MAIL_DELIVERY };
    return this.parseMailDelivery(row.value);
  }

  private envUrl(): string | null {
    const u = this.config.get<string>('CLOUDWAYS_MAIL_URL')?.trim();
    return u || null;
  }

  private envApiKey(): string | null {
    const k = this.config.get<string>('CLOUDWAYS_MAIL_API_KEY')?.trim();
    return k || null;
  }

  /** Resolved credentials for outbound relay (never return to UI). */
  async resolveCloudwaysRelay(): Promise<{
    mode: MailDeliveryMode;
    url: string | null;
    apiKey: string | null;
  }> {
    const stored = await this.getMailDeliveryStored();
    const url = stored.url || this.envUrl();
    const apiKey =
      decryptSecret(this.config, stored.apiKeyEnc) || this.envApiKey();
    return { mode: stored.mode, url, apiKey };
  }

  async getMailDeliveryPublic(): Promise<MailDeliveryPublic> {
    const stored = await this.getMailDeliveryStored();
    const envUrl = Boolean(this.envUrl());
    const envKey = Boolean(this.envApiKey());
    const url = stored.url || this.envUrl();
    const apiKey =
      decryptSecret(this.config, stored.apiKeyEnc) || this.envApiKey();
    return {
      mode: stored.mode,
      url: stored.url,
      apiKeyConfigured: Boolean(stored.apiKeyEnc) || envKey,
      relayReady: Boolean(url && apiKey),
      envFallback: {
        urlConfigured: envUrl,
        apiKeyConfigured: envKey,
      },
    };
  }

  async upsertMailDelivery(
    input: {
      mode: MailDeliveryMode;
      url?: string | null;
      apiKey?: string | null;
    },
    actorId: string,
  ): Promise<MailDeliveryPublic> {
    const prev = await this.getMailDeliveryStored();
    const next: MailDeliveryStored = {
      mode: input.mode,
      url:
        input.url === undefined
          ? prev.url
          : input.url && input.url.trim()
            ? input.url.trim()
            : null,
      apiKeyEnc: prev.apiKeyEnc,
    };

    if (input.apiKey !== undefined) {
      if (input.apiKey === null || input.apiKey === '') {
        next.apiKeyEnc = null;
      } else {
        next.apiKeyEnc = encryptSecret(this.config, input.apiKey);
      }
    }

    if (next.mode === 'cloudways') {
      const resolvedUrl = next.url || this.envUrl();
      const resolvedKey =
        decryptSecret(this.config, next.apiKeyEnc) || this.envApiKey();
      if (!resolvedUrl || !resolvedKey) {
        throw new BadRequestException(
          'Cloudways mode requires a send URL and API key (form or CLOUDWAYS_MAIL_* env)',
        );
      }
    }

    await this.prisma.platformSetting.upsert({
      where: { key: MAIL_DELIVERY_KEY },
      create: {
        key: MAIL_DELIVERY_KEY,
        value: next as unknown as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
      update: {
        value: next as unknown as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
    });

    return this.getMailDeliveryPublic();
  }
}
