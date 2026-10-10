export const MAIL_DELIVERY_KEY = 'mail_delivery';

export type MailDeliveryMode = 'direct' | 'cloudways';

export type MailDeliveryStored = {
  mode: MailDeliveryMode;
  /** Cloudways (or other relay) send endpoint */
  url: string | null;
  /** AES-GCM encrypted API key; never expose raw to clients */
  apiKeyEnc: string | null;
};

export type MailDeliveryPublic = {
  mode: MailDeliveryMode;
  url: string | null;
  apiKeyConfigured: boolean;
  /** True when mode=cloudways and url+key resolve (DB or env) */
  relayReady: boolean;
  envFallback: {
    urlConfigured: boolean;
    apiKeyConfigured: boolean;
  };
};

export const DEFAULT_MAIL_DELIVERY: MailDeliveryStored = {
  mode: 'direct',
  url: null,
  apiKeyEnc: null,
};
