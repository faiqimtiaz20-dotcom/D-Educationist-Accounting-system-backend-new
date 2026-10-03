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

export function decryptSecret(
  config: ConfigService,
  payload: string | null | undefined,
): string | null {
  if (!payload) return null;
  const key = keyFromConfig(config);
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
