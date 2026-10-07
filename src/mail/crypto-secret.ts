import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';

const ALGO = 'aes-256-gcm';

function keyFromConfig(config: ConfigService): Buffer {
  const raw =
    config.get<string>('SMTP_SECRET') ||
    config.get<string>('JWT_ACCESS_SECRET') ||
    'dev-only-smtp-secret';
  return createHash('sha256').update(raw).digest();
}

/** Encrypt UTF-8 plaintext → base64(iv+tag+ciphertext). */
export function encryptSecret(config: ConfigService, plaintext: string): string {
  const key = keyFromConfig(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypt payload. Returns null if missing/corrupt/wrong key
 * (e.g. SMTP_SECRET rotated after password was saved) — never throws.
 */
export function decryptSecret(
  config: ConfigService,
  payload: string | null | undefined,
): string | null {
  if (!payload) return null;
  try {
    const key = keyFromConfig(config);
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}
