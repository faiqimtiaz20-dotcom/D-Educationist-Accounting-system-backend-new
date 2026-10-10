import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export type CloudwaysTransportPayload = {
  provider: string;
  authMode: 'PASSWORD' | 'OAUTH';
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  username?: string | null;
  password?: string;
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    clientId: string;
    clientSecret: string;
    user: string;
  };
};

export type CloudwaysSendInput = {
  url: string;
  apiKey: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  from: { email: string; name?: string | null };
  transport: CloudwaysTransportPayload;
  attachments?: Array<{
    filename: string;
    contentBase64: string;
    contentType?: string;
    cid?: string;
  }>;
};

@Injectable()
export class CloudwaysMailClient {
  private readonly logger = new Logger(CloudwaysMailClient.name);

  private async request<T>(
    url: string,
    apiKey: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const base = url.replace(/\/$/, '');
    // Accept either full .../send URL or base .../api/v1
    const endpoint = /\/send$/i.test(base)
      ? path === '/send'
        ? base
        : base.replace(/\/send$/i, path)
      : `${base}${path.startsWith('/') ? path : `/${path}`}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Api-Key': apiKey,
          ...(init?.headers || {}),
        },
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Cloudways relay unreachable: ${message}`);
      throw new ServiceUnavailableException(
        `Cloudways mail API unreachable: ${message}`,
      );
    }

    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      error?: { message?: string };
      messageId?: string;
      accepted?: string[];
      status?: string;
    };

    if (!res.ok || body.success === false) {
      const msg =
        body.error?.message ||
        body.message ||
        `Cloudways mail API HTTP ${res.status}`;
      throw new BadRequestException(`Email send failed (relay): ${msg}`);
    }

    return body as T;
  }

  async ping(url: string, apiKey: string) {
    return this.request<{ success: boolean; status: string }>(
      url,
      apiKey,
      '/health',
      { method: 'GET' },
    );
  }

  async send(input: CloudwaysSendInput) {
    const result = await this.request<{
      success: boolean;
      messageId?: string;
      accepted?: string[];
    }>(input.url, input.apiKey, '/send', {
      method: 'POST',
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        cc: input.cc,
        from: input.from,
        transport: input.transport,
        attachments: input.attachments,
      }),
    });
    return {
      messageId: result.messageId || 'cloudways-relay',
      accepted: result.accepted || [input.to],
    };
  }

  /** Uses Cloudways server's own default SMTP (.env) — not tenant transport. */
  async sendRelaySelfTest(input: {
    url: string;
    apiKey: string;
    to: string;
  }) {
    return this.request<{ success: boolean; messageId?: string }>(
      input.url,
      input.apiKey,
      '/test',
      {
        method: 'POST',
        body: JSON.stringify({
          to: input.to,
          subject: 'Cloudways mail relay test',
          text: 'Relay self-test from D’ Educationist CRM.',
        }),
      },
    ).then((r) => ({
      messageId: r.messageId || 'relay-test',
    }));
  }
}
